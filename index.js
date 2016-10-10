/**
 * @fileoverview A simple dependency injection framework.
 *
 * Goals:
 * - Handle function, constructor, and constant injectors
 * - Allow asynchronous injectors
 * - Easy forking for multiple environments
 * - Allow specifying dependencies by name (robot leg problem)
 * - Unfilfilled dependencies are failures, not null
 * - Allow easy debugging of dependency graph
 */
const immutable  = require('immutable')

/**
 * A registry for holding all dependency providers.
 *
 * Registries are immutable and should generally be global to an application,
 * though will also often be forked for different environments, e.g., a unit
 * testing path is likely to provide different low-level data libraries.
 *
 * TKTK This is analagous to the Graph() in Shepherd.
 */
class Registry {
  /**
   * @param {?immutable.Map<string, Provider>} opt_providers
   */
  constructor(opt_providers) {
    this._providers = opt_providers || new immutable.Map()
  }

  /**
   * @param {string} name
   * @param {Function} Ctor
   * @param {?Object} opt_options
   * @return {Registry}
   */
  ctor(name, Ctor, opt_options) {
    assert(typeof Ctor == 'function',
        `Cannot provide nonfunction for constructor provider ${name}`)
    const deps = getDependencyNames(Ctor)
    return this._add(name, 'CTOR', Ctor, deps, opt_options)
  }

  /**
   * @param {string} name
   * @param {any} constant
   * @return {Registry}
   */
  constant(name, constant) {
    assert(constant != null,
        `Cannot provide null for constant provider ${name}`)
    return this._add(name, 'CONSTANT', constant, [])
  }

  /**
   * @param {string} name
   * @param {Function} fn
   * @param {?Object} opt_options
   * @return {Registry}
   */
  fn(name, fn, opt_options) {
    assert(typeof fn == 'function',
        `Cannot provide nonfunction for function provider ${name}`)
    const dependencies = getDependencyNames(fn)
    return this._add(name, 'FN', fn, dependencies, opt_options)
  }

  /**
   * @param {string} name
   * @param {ProviderType} type
   * @param {any} factory
   * @param {Array<string>} deps
   * @param {Object} options
   * @return {Registry}
   */
  _add(name, type, factory, deps, options={}) {
    let mappedDeps = deps
    if (options.using) {
      mappedDeps = deps.map(d => options.using[d] || d)
    }
    const provider = new Provider(name, type, factory, mappedDeps, {
      isCacheable: !!options.isCacheable
    })
    return new Registry(this._providers.set(name, provider))
  }

  /**
   * @return {Injector}
   */
  buildInjector() {
    // TODO validate graph with top-sort
    return new Injector(this._providers)
  }

  /**
   * @param {string} name
   * @return {Promise<any>}
   */
  build(name) {
    return this.buildInjector().build(name)
  }
}

/**
 * Parse the dependency names out of a function provider.
 *
 * First checks for named dependencies in the `$ij` field, used in minified
 * contexts. Otherwise attempts to parse the dependencies by name from the
 * function signature, accounting for ES6 classes.
 *
 * @param {Function} fn
 * @return {Array<string>}
 */
function getDependencyNames(fn) {
  if (fn.$ij && Array.isArray(fn.$ij)) return fn.$ij

  const fnStr = fn.toString()
  let keywordIdx = 0

  // If this is an ES6 class
  if (fnStr.startsWith('class')) {
    const ctorMatch = /\bconstructor\b/.exec(fnStr)
    // Empty default constructor
    if (!ctorMatch) return []
    keywordIdx = ctorMatch.index
  }

  const leftParenIdx = fnStr.indexOf('(', keywordIdx)
  const rightParenIdx = fnStr.indexOf(')', keywordIdx)
  const params = fnStr.substring(leftParenIdx + 1, rightParenIdx).trim()
  if (!params) return []

  return params.split(',').map(p => p.trim())
}

/** The descriptor of a provider. */
class Provider {
  constructor(name, type, factory, deps, opts={}) {
    /**
     * The global name of the Provider as it exists in the Registry.
     * @type {string}
     */
    this.name = name

    /**
     * The type of this provider, used in determining how to build itself.
     * @type {ProviderType}
     */
    this.type = type

    /**
     * The actual value of the provider, which can be anything
     * @type {any}
     */
    this.factory = factory

    /**
     * The list of dependencies required by this Provider, identified by their
     * global names in the Registry.
     * @type {Array<string>}
     */
    this.dependencies = deps

    /**
     * Whether this Provider's result can be globally cached.
     * @type {boolean}
     */
    this.isCacheable = !!opts.isCacheable

    Object.seal(this)
  }
}

/**
 * An injector for building dependencies from a registry.
 *
 * Injectors have state and will typically live for the lifecycle of an
 * application. It handles caching singleton dependencies, e.g., a database
 * connection, but will build non-cacheable dependencies once per build call.
 *
 * Injectors must be valid at the time of instantiation, and so should only be
 * built with Registry#buildInjector().
 *
 * TKTK This is analagous to a Builder() in Shepherd.
 */
class Injector {
  constructor(providers) {
    /** @private {immutable.Map<string, Provider>} */
    this._providers = providers

    /** @private {immutable.Map<string, any>} */
    this._cache = new immutable.Map()
  }

  /**
   * Build a dependency from the registry.
   *
   * This method will build a dependency (and its subdependencies) anew each
   * time it's called unless the dependency has specifically indicated that it
   * is cacheable. However it will not build a dependency more than once per
   * call, even if the same dependency is required multiple times.
   *
   * @param {string} name
   * @param {Promise<any>}
   */
  build(name) {
    if (!this._providers.has(name)) {
      return Promise.reject(new Error(`Provider not found for "${name}"`))
    }

    const provider = this._providers.get(name)
    return this._build(provider, name)
        .then((results) => results.get(provider.name))
        .catch((err) => {
          if (err instanceof ProviderNotFound) {
            err.parents.push(name)
            const chain = err.parents.join(' → ')
            throw new Error(err.message + `(in dependency chain: ${chain})`)
          }
          throw err
        })
  }

  /**
   * @param {Provider} provider
   * @return {Promise<immutable.Map<string, any>>}
   */
  _build(provider) {
    if (this._cache.has(provider.name)) {
      return this._cache.get(provider.name)
    }

    const childPromises = provider.dependencies.map((depName) => {
      const depProvider = this._providers.get(depName)
      if (!depProvider) {
        // TODO clean up API for parents
        const err = new ProviderNotFound(`Provider not found for "${depName}"`)
        err.parents = [provider.name]
        return Promise.reject(err)
      }

      return this._build(depProvider)
        .catch((err) => {
          if (err instanceof ProviderNotFound) {
            err.parents.push(provider.name)
          }
          throw err
        })
    })

    return Promise.all(childPromises)
      .then((depResults) => {
        const results = new immutable.Map().merge(...depResults)
        return this._buildProvider(provider, results)
          .then((result) => {
            if (provider.isCacheable) {
              this._cache = this._cache.set(provider.name, result)
            }
            return results.set(provider.name, result)
          })
      })
  }

  /**
   * @param {Provider} provider
   * @param {immutable.Map<string, any>} results
   * @return {Promise<any>}
   */
  _buildProvider(provider, results) {
    const args = provider.dependencies.map(d => results.get(d))
    switch (provider.type) {
      case 'CONSTANT':
        return Promise.resolve(provider.factory)
      case 'CTOR':
        return Promise.resolve(new provider.factory(...args))
      case 'FN':
        return Promise.resolve(provider.factory(...args))
    }
  }
}

class ProviderNotFound extends Error {
  /**
   * @param {string} name
   * @return {ProviderNotFound}
   */
  addParent(name) {
    if (!this._parents) this._parents = [name]
    else this._parents.push(name)
    return this
  }

  /** @return {Array<string>} */
  get parents() {
    return this._parents || []
  }
}

/**
 * @param {T|?T} val
 * @param {string} msg
 * @return {T}
 * @template {T}
 */
function assert(val, msg) {
  if (!val) {
    throw new Error(msg)
  }
  return val
}

module.exports = {
  Registry,
}
