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
 *
 * @flow
 */
import q from 'promise-utils'
import immutable from 'immutable'

type ProviderType = 'CONSTANT' | 'CTOR' | 'FN';

/** The descriptor of a provider. */
class Provider<T> {
  /** The global name of the Provider as it exists in the Registry. */
  name: string;

  /** The type of this provider, used in determining how to build itself. */
  type: ProviderType;

  /** The actual value of the provider, which can be anything. */
  factory: T;

  /**
   * The list of dependencies required by this Provider, identified by their
   * global names in the Registry.
   */
  dependencies: Array<string>;

  /** Whether this Provider's result can be globally cached. */
  isCacheable: boolean;

  constructor(
      name: string, type: ProviderType, factory: T,
      dependencies: Array<string>, options={}) {
    this.name = name
    this.type = type
    this.factory = factory
    this.dependencies = dependencies
    this.isCacheable = !!options.isCacheable
    Object.seal(this)
  }
}

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
  _providers: immutable.Map<string, Provider>;

  constructor(opt_providers?: immutable.Map<string, Provider>) {
    this._providers = opt_providers || new immutable.Map<string, Provider>
  }

  _add(
      name: string, type: ProviderType, factory: T,
      dependenciesOrOptions?: Array<string>|Object, options?: Object) {
    let dependencies
    let options
    if (Array.isArray(dependenciesOrOptions)) {
      dependencies = dependenciesOrOptions
      options = options
    } else {
      options = dependenciesOrOptions
    }

    if (type == 'FN' && typeof factory != 'function') {
      throw new Error()
      TK throw errors for bad defs
    }
  }

  buildInjector(): Injector {
    // TODO validate graph with top-sort
    return new Injector(this._providers)
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
  _providers: immutable.Map<string, Provider>;
  _cache: immutable.Map<string, any>;

  constructor(providers: immutable.Map<string, Provider>) {
    this._providers = providers
    this._cache = new immutable.Map()
  }

  /**
   * Build a dependency from the registry.
   *
   * This method will build a dependency (and its subdependencies) anew each
   * time it's called unless the dependency has specifically indicated that it
   * is cacheable. However it will not build a dependency more than once per
   * call, even if the same dependency is required multiple times.
   */
  build(name: string): Promise<any> {
    if (!this._providers.has(name)) {
      return Promise.reject(
          new ProviderNotFoundError(`Provider for "${name}" not found`))
    }

    const provider = this._providers.get(name)
    return this._build(provider).then((results) => results.get(provider.name))
  }

  _build(provider: Provider): Promise<immutable.Map<string, any>> {
    if (this._cache.has(provider.name)) {
      return this._cache.get(provider.name)
    }

    return q.all(provider.dependencies.map((depName) => {
      return this._build(this._providers.get(depName))
    }))
      .then((resultsArr) => {
        const results = new immutable.Map().merge(...resultsArr)
        return this._buildProvider(provider, results)
          .then((result) => {
            if (provider.isCacheable) {
              this._cache = this._cache.set(provider.name, result)
            }
            return results.set(provider.name, result)
          })
      })
  }

  _buildProvider(provider: Provider<T>, results: immutable.Map<string, any>)
      : Promise<T> {
    const args = provider.dependencies.map(d => results.get(d))
    switch (provider.type) {
      case 'CONSTANT':
        return Promsie.resolve(provider.factory)
      case 'CTOR':
        return Promise.resolve(new provider.factory(...args))
      case 'FN':
        return Promise.resolve(provider.factory(...args))
    }
  }
}

class ProviderNotFoundError extends Error {}

export default {
  Registry,
}
