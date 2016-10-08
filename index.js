import _ from './utils'

const ProviderType = {
  CTOR: Symbol('constructor'),
  FACTORY: Symbol('factory'),
  CONSTANT: Symbol('constant'),
}

const VALID_OPTIONS = ['override', 'using']

function Options(opts) {
  this.override = opts.override == null ? false : opts.override
  this.using = opts.using == null ? null : opts.using
  for (key in opts) {
    if (VALID_OPTIONS.indexOf(key) == -1) {
      throw new Error(`Supplied invalid option: ${key}`)
    }
  }
}

class Registry {
  constructor() {
    this._providers = new immutable.Map()
  }

  ctor(name: string, provider: Class<Object>, deps?: Array<string>, opts?: ProviderOptions) {
    return this.add(name, ProviderType.CTOR, provider, opt_deps, opt_opts)
  }

  factory(name: string, provider: Function, deps?: Array<string>, opt_opts?: ProviderOptions) {
    return this.add(name, ProviderType.FACTORY, provider, opt_deps, opt_opts)
  }

  constant(name: string, provider: any, opt_opts) {
    return this.add(name, ProviderType.CONSTANT, provider, [], opt_opts)
  }

  /**
   * Add a provider.
   *
   * @param {string} name
   * @param {ProviderType} type
   * @param {(Array.<string>|Object)=} opt_deps
   * @param {Object=} opt_opts
   * @return {Registry}
   */
  add(name, type, provider, opt_deps, opt_opts) {
    let deps = Array.isArray(opt_deps) ? opt_deps : provider.$inject
    let opts = Array.isArray(opt_deps) ? opt_opts : opt_deps
    deps = deps || []
    opts = new Options(opts || {})

    const dependencyMap = new Map()
    deps.forEach((depName) => {
      const providerName = opts.using && opts.using[depName] || depName
      dependencyMap.set(depName, providerName)
    })

    return this._add(name, type, provider, dependencyMap, opts)
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
    return new Injector(this._providers).build(name)
  }
}

function build(name: string, providers: immutable.Map<string, Provider>): Promise<any> {
  let results = new immutable.Map()
  if (!this._providers.has(name)) {
    return Promise.reject(new ProviderNotFound(`Cannot find provider ${name}`))
  }
  if (this._results.has(name)) {
    return Promise.resolve(this._results.get(name))
  }


}

class Injector {
  constructor(providers: immutable.Map<string, Provider>) {
    this._providers = providers
    this._results = new immutable.Map()
  }

  build(name: string): Promise<any> {
    if (!this._providers.has(name)) {
      return Promise.reject(new ProviderNotFound(
          `Cannot find provider for "${name}"`))
    }

    if (this._results.has(name)) {
      return Promise.resolve(this._results.get(name))
    }

    const provider = this._providers.get(name)
    const resultsMap = new Map()
    const promises = _.map(provider.getDependencyMap(), (providerName, dependencyName) => {
      const promise = isLiteral(providerName) ?
          Promise.resolve(providerName) :
          this.build(providerName)

      return promise.then((result) => {
        resultsMap.set(dependencyName, result)
      })
    })

    return Promise.all(promises).then(() => {
      const result = provider.buildWithDependencies(resultsMap)
      this._results.set(name, result)
      return result
    })
  }
}

class ProviderDescriptor {
  constructor({name, provider, type, dependencyMap}, {shouldCache}) {
    this._name = name
    this._provider = provider
    this._providerType = providerType
    this._dependencyMap = dependencyMap
  }

  buildWithDependencies(resultsMap) {
    return new Promise((resolve, reject) => {
      switch (this._providerType) {
        case ProviderType.CTOR:
          return resolve(new this._provider(resultsMap))
        case ProviderType.FACTORY:
          return resolve(this._provider(resultsMap))
        case ProviderType.CONSTANT:
          return resolve(this._provider)
        default:
          reject(new Error(`Invalid provider type ${this._providerType}`))
      }
    })
  }
}

function literal(value) {
  return {__literal: value}
}

function isLiteral(test) {
  return !!(test && test.__literal)
}

function getLiteral(test) {
  return test && test.__literal || null
}

export default {
  literal,
  Registry,
  ProviderType,
}
