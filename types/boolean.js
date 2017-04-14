'use strict'

const Type = require('./type')

class TypeBoolean extends Type {
  static get (opts) {
    return new TypeBoolean(opts)
  }

  constructor (opts) {
    super(Object.assign({ defaultValue: false }, opts))
  }

  get datatype () {
    return 'boolean'
  }

  setValue (value) {
    this._value = typeof value === 'boolean' ? value : value === 'true'
  }
}

module.exports = TypeBoolean
