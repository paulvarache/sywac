'use strict'

class Api {
  static get DEFAULT_COMMAND_INDICATOR () {
    return '*'
  }

  static get (opts) {
    return new Api(opts)
  }

  constructor (opts) {
    opts = opts || {}
    this.types = []
    this._helpOpts = opts.helpOpts || {}
    this._factories = {
      unknownType: this.getUnknownType,
      context: this.getContext,
      helpBuffer: this.getHelpBuffer,
      boolean: this.getBoolean,
      string: this.getString,
      number: this.getNumber,
      helpType: this.getHelpType,
      versionType: this.getVersionType,
      array: this.getArray,
      positional: this.getPositional,
      commandType: this.getCommand
    }
    this._showHelpByDefault = 'showHelpByDefault' in opts ? opts.showHelpByDefault : false
    this.configure(opts)
    if (!Api.ROOT_NAME) Api.ROOT_NAME = this.name
  }

  configure (opts) {
    opts = opts || {}
    // lazily configured instance dependencies (expects a single instance)
    this._utils = opts.utils || this._utils

    // lazily configured factory dependencies (expects a function to call per instance)
    if ('factories' in opts) {
      Object.keys(opts.factories).forEach(name => this.registerFactory(name, opts.factories[name]))
    }

    // other
    this._name = opts.name || this._name
    this._parentName = opts.parentName || this._parentName // TODO this seems awfully hacky
    return this
  }

  newChild (commandName) {
    // don't need from parent: types
    // keep from parent: _factories, utils, name (plus command chain)
    return new Api({
      factories: this._factories,
      utils: this.utils,
      name: this.name + ' ' + commandName,
      parentName: this.name,
      helpOpts: this._assignHelpOpts({}, this.helpOpts),
      showHelpByDefault: this._showHelpByDefault
    })
  }

  _assignHelpOpts (target, source) {
    [
      'lineSep', 'sectionSep', 'pad', 'indent', 'split', 'icon', 'slogan',
      'usagePrefix', 'usageHasOptions', 'groupOrder', 'epilogue', 'maxWidth'
    ].forEach(opt => {
      if (opt in source) target[opt] = source[opt]
    })
    return target
  }

  // lazy dependency accessors
  get unknownType () {
    if (!this._unknownType) this._unknownType = this.get('unknownType').withParent(Api.ROOT_NAME)
    return this._unknownType
  }

  get utils () {
    if (!this._utils) this._utils = require('./lib/utils').get()
    return this._utils
  }

  get helpOpts () {
    return this._helpOpts
  }

  get name () {
    if (typeof this._name !== 'string') this._name = require('path').basename(process.argv[1], '.js')
    return this._name
  }

  get parentName () {
    return this._parentName || 'node'
  }

  // type factories
  registerFactory (name, factory) {
    if (name && typeof factory === 'function') this._factories[name] = factory
    return this
  }

  get (name, opts) {
    if (name && this._factories[name]) return this._factories[name].call(this, opts)
    return null
  }

  getUnknownType (opts) {
    return require('./types/unknown').get(opts)
  }

  getContext (opts) {
    return require('./context').get(opts)
  }

  getHelpBuffer (opts) {
    return require('./buffer').get(opts)
  }

  getBoolean (opts) {
    return require('./types/boolean').get(opts)
  }

  getString (opts) {
    return require('./types/string').get(opts)
  }

  getNumber (opts) {
    return require('./types/number').get(opts)
  }

  getHelpType (opts) {
    return require('./types/help').get(opts)
  }

  getVersionType (opts) {
    return require('./types/version').get(opts)
  }

  getArray (opts) {
    return require('./types/array').get(opts)
  }

  getPositional (opts) {
    return require('./types/positional').get(opts)
  }

  getCommand (opts) {
    return require('./types/command').get(opts)
  }

  // help text
  preface (icon, slogan) {
    this.helpOpts.icon = icon
    this.helpOpts.slogan = slogan
    return this
  }

  usage (usage) {
    if (typeof usage === 'string') this.helpOpts.usage = usage
    else {
      const keyMap = {
        usage: 'usage',
        prefix: 'usagePrefix',
        commandPlaceholder: 'usageCommandPlaceholder',
        argsPlaceholder: 'usageArgsPlaceholder',
        optionsPlaceholder: 'usageOptionsPlaceholder'
      }
      Object.keys(keyMap).forEach(key => {
        if (key in usage) this.helpOpts[keyMap[key]] = usage[key]
      })
    }
    return this
  }

  groupOrder (orderArray) {
    if (Array.isArray(orderArray) || typeof orderArray === 'undefined') this.helpOpts.groupOrder = orderArray
    return this
  }

  epilogue (epilogue) {
    this.helpOpts.epilogue = epilogue
    return this
  }

  outputSettings (settings) {
    ['lineSep', 'sectionSep', 'pad', 'indent', 'split', 'maxWidth'].forEach(opt => {
      if (opt in settings) this.helpOpts[opt] = settings[opt]
    })
    return this
  }

  showHelpByDefault (boolean) {
    this._showHelpByDefault = boolean !== false
    return this
  }

  // complex types
  command (dsl, opts) {
    this._internalCommand(dsl, opts)
    return this
  }

  _internalCommand (dsl, opts) {
    opts = opts || {}

    // argument shuffling
    if (typeof opts === 'function') {
      opts = { run: opts }
    }
    if (dsl && typeof dsl === 'object') {
      opts = Object.assign({}, dsl, opts)
    } else if (typeof dsl === 'string') {
      opts.flags = dsl
    }
    if (!opts.flags && opts.aliases) opts.flags = [].concat(opts.aliases)[0]

    // opts is an object and opts.flags is the dsl
    // split dsl into name/alias and positionals
    // then populate opts.aliases and opts.params
    const mp = this.utils.stringToMultiPositional(opts.flags)
    const name = mp.shift()
    opts.aliases = opts.aliases ? Array.from(new Set([name].concat(opts.aliases))) : [name]
    if (mp.length) {
      this.helpOpts.usageHasArgs = true
      if (!opts.params) opts.params = mp
      else if (!opts.paramsDsl) opts.paramsDsl = mp.join(' ')
    }

    this.helpOpts.usageHasCommand = true

    const commandType = this.get('commandType', opts)
    this.custom(commandType)
    return commandType
  }

  positional (dsl, opts) {
    opts = opts || {}
    let addedToHelp = false

    // TODO this logic is repetitive and messy
    if (Array.isArray(dsl)) {
      opts.params = dsl
    } else if (typeof dsl === 'object') {
      if (dsl.params) opts = dsl
      else opts.params = dsl
    } else if (typeof dsl === 'string') {
      this.helpOpts.usagePositionals = (this.helpOpts.usagePositionals || []).concat(dsl)
      addedToHelp = true
      let array = this.utils.stringToMultiPositional(dsl)
      if (!opts.params) {
        opts.params = array
      } else if (Array.isArray(opts.params)) {
        opts.params = array.map((string, index) => {
          return opts.params[index] ? Object.assign({ flags: string }, opts.params[index]) : string
        })
      } else {
        opts.params = Object.keys(opts.params).map((key, index) => {
          let obj = opts.params[key]
          if (obj && !obj.flags) obj.flags = array[index]
          // if (obj && !obj.aliases) obj.aliases = key
          return obj
        })
      }
    }

    opts.ignore = [].concat(opts.ignore).filter(Boolean)

    let params = Array.isArray(opts.params) ? opts.params : Object.keys(opts.params).map(key => {
      let obj = opts.params[key]
      if (obj && !obj.flags) obj.flags = key
      return obj
    })

    let numSkipped = 0
    params.forEach((param, index) => {
      if (!param) return numSkipped++

      // accept an array of strings or objects
      if (typeof param === 'string') param = { flags: param }
      if (!param.flags && param.aliases) param.flags = [].concat(param.aliases)[0]

      if (!addedToHelp) this.helpOpts.usagePositionals = (this.helpOpts.usagePositionals || []).concat(param.flags)

      // allow "commentary" things in positional dsl string via opts.ignore
      if (~opts.ignore.indexOf(param.flags)) return numSkipped++

      // TODO if no flags or aliases, throw error

      // convenience to define descriptions in opts
      if (!(param.description || param.desc) && (opts.paramsDescription || opts.paramsDesc)) {
        param.desc = [].concat(opts.paramsDescription || opts.paramsDesc)[index - numSkipped]
      }
      if (!param.group && opts.paramsGroup) param.group = opts.paramsGroup

      // don't apply command desc to positional params (via configure calls below)
      let optsDescription = opts.description
      let optsDesc = opts.desc
      delete opts.description
      delete opts.desc

      // inferPositionalProperties will generate flags/aliases for wrapped elementType needed for parsing
      let positionalFlags = param.flags
      delete param.flags

      param = Object.assign(this.utils.inferPositionalProperties(positionalFlags, Object.keys(this._factories)), param)
      if (!param.elementType) param.elementType = this._getType(param).configure(opts, false)

      param.flags = positionalFlags
      let positional = this.get('positional', param).configure(opts, false)

      opts.description = optsDescription
      opts.desc = optsDesc

      if (this.unknownType) this.unknownType.addPositional(positional)
      this.custom(positional)
    })

    return this
  }

  // configure any arg type
  custom (type) {
    if (type) {
      if (typeof type.withParent === 'function') type.withParent(this.name)
      if (typeof type.validateConfig === 'function') type.validateConfig(this.utils)
      this.types.push(type)
    }
    return this
  }

  _normalizeOpts (flags, opts) {
    opts = opts || {}
    if (Array.isArray(flags)) {
      opts.aliases = flags // treat an array as aliases
    } else if (typeof flags === 'string') {
      opts.flags = flags // treat a string as flags
    } else if (typeof flags === 'object') {
      opts = flags
    }
    return opts
  }

  _addOptionType (flags, opts, name) {
    this.helpOpts.usageHasOptions = true
    return this.custom(this._getType(flags, opts, name))
  }

  _getType (flags, opts, name) {
    opts = this._normalizeOpts(flags, opts)

    name = String(name || opts.type)
    if (name.indexOf(':') !== -1) {
      let types = name.split(':').filter(Boolean)
      if (types[0] === 'array') return this._getArrayType(flags, opts, types.slice(1).join(':') || 'string')
      name = types[0]
    }

    return this.get(name, opts)
  }

  _getArrayType (flags, opts, subtypeName) {
    opts = this._normalizeOpts(flags, opts) // TODO this may be redundant

    subtypeName = String(subtypeName || opts.type)
    if (subtypeName.indexOf(':') !== -1) {
      let types = subtypeName.split(':').filter(Boolean)
      if (types[0] === 'array') {
        opts.elementType = this._getArrayType(flags, opts, types.slice(1).join(':') || 'string')
        return this.get('array', opts)
      }
      subtypeName = types[0]
    }

    opts.elementType = this.get(subtypeName, opts)
    return this.get('array', opts)
  }

  // specify 'type' (as string) in opts
  option (flags, opts) {
    return this._addOptionType(flags, opts)
  }

  // common individual value types
  boolean (flags, opts) {
    return this._addOptionType(flags, opts, 'boolean')
  }

  string (flags, opts) {
    return this._addOptionType(flags, opts, 'string')
  }

  number (flags, opts) {
    return this._addOptionType(flags, opts, 'number')
  }

  // specialty types
  help (flags, opts) {
    return this._addOptionType(flags, opts, 'helpType')
  }

  version (flags, opts) {
    return this._addOptionType(flags, opts, 'versionType')
  }

  // multiple value types
  array (flags, opts) {
    return this._addOptionType(flags, opts, 'array')
  }

  stringArray (flags, opts) {
    return this._addOptionType(flags, opts, 'array:string')
  }

  numberArray (flags, opts) {
    return this._addOptionType(flags, opts, 'array:number')
  }

  // TODO more types

  // once configured with types, parse and exec asynchronously
  // return a Promise<Result>
  parse (args) {
    // init context and kick off recursive type parsing/execution
    let context = this.initContext(false).slurpArgs(args)
    return this.parseFromContext(context).then(whenDone => {
      if (
        (context.helpRequested && !context.output) ||
        (this._showHelpByDefault && !context.details.args.length && !context.output && !context.commandHandlerRun)
      ) {
        if (!context.helpRequested) context.deferHelp() // make sure help is seen as requested
        context.addDeferredHelp(this.initHelpBuffer())
      } else if (context.versionRequested && !context.output) {
        context.addDeferredVersion()
      } else if (context.messages.length && !context.output) {
        context.addDeferredHelp(this.initHelpBuffer())
      }
      return whenDone
    }).catch(err => {
      context.unexpectedError(err)
    }).then(whenDone => {
      try {
        this.types.forEach(type => type.reset())
        if (this.unknownType) this.unknownType.reset()
      } catch (err) {
        context.unexpectedError(err)
      }
      return context.toResult()
    })
  }

  parseFromContext (context) {
    // first complete configuration for special types
    let hasCommands = false
    let hasDefaultCommand = false
    this.types.forEach(type => {
      if (type.needsApi) type.configure({ api: this.newChild(type.aliases[0]) }, false)

      let implicit = type.implicitCommands
      if (implicit && implicit.length) this.unknownType.addImplicit(implicit, type)

      if (type.datatype === 'command') {
        hasCommands = true
        if (type.isDefault) hasDefaultCommand = true
      }
    })
    if (this._showHelpByDefault && hasCommands && !hasDefaultCommand) {
      this._internalCommand(Api.DEFAULT_COMMAND_INDICATOR, (argv, context) => {
        context.deferHelp().addDeferredHelp(this.initHelpBuffer())
      }).configure({ api: this.newChild(Api.DEFAULT_COMMAND_INDICATOR) }, false)
    }

    // add known types to context
    this.applyTypes(context)
    // run async parsing for all types except unknown
    let parsePromises = this.types.map(type => type.parse(context))

    return Promise.all(parsePromises).then(whenDone => {
      // now run async parsing for unknown
      return (this.unknownType && this.unknownType.parse(context)) || Promise.resolve(true)
    }).then(whenDone => {
      // once all parsing is complete, populate argv in context (sync)
      let types = this.types.map(type => type.toResult())
      if (this.unknownType) types = types.concat(this.unknownType.toResult())
      context.populateArgv(types)

      // TODO before postParse, determine if any are promptable (and need prompting) and prompt each in series

      // run async post-parsing
      let postParse = this.types.map(type => type.postParse(context)) // this potentially runs commands
      if (this.unknownType) postParse = postParse.concat(this.unknownType.postParse(context))
      return Promise.all(postParse)
    })
  }

  initContext (includeTypes) {
    let context = this.get('context', { utils: this.utils })
    return includeTypes ? this.applyTypes(context) : context
  }

  applyTypes (context) {
    context.pushLevel(this.name, this.types.map(type => type.toObject()))
    return context
  }

  initHelpBuffer () {
    let helpOpts = Object.assign({ utils: this.utils, usageName: this.name }, this.helpOpts)
    return this.get('helpBuffer', helpOpts)
  }

  // optional convenience methods
  getHelp (opts) {
    return this.initContext(true).addHelp(this.initHelpBuffer(), opts).output
  }
}

Api.ROOT_NAME = undefined // defined by first Api instance in constructor

module.exports = Api
