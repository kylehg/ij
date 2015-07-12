import _ from './utils'

const ProviderType = {
  CTOR: Symbol('constructor'),
  FACTORY: Symbol('factory'),
  CONST: Symbol('constant'),
}

class Registry {
  constructor() {
    this._providers = new Map()
  }

  /**
   * Add a provider.
   */
  _add(name, type, provider, dependencyMap, opts) {
    if (this._providers.has(name) && !opts.override) {
      throw new Error(`Attempted to re-register dependency ${name}`)
    }

    const descriptor = new ProviderDescriptor({name, type, provider, dependencyMap}, opts)
    this._providers.set(name, descriptor)
    return this
  }

  build(name) {
    return new Promise((reject, resolve) => {
      if (!this._providers.has(name)) {
        return reject(new Error(`No provider "${name}"`))
      }

    })
  }
}

class ProviderDescriptor {
  constructor({name, provider, type, dependencies}, {shouldCache}) {
    this._name = name
    this._provider = provider
    this._providerType = providerType
    this._dependencies = dependencies || {}

    this._shouldCache = shouldCache == null ? true : shouldCache
  }
}

export default {

}
