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
 * 
 */
import immutable from 'immutable';

const IMap = immutable.Map;

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

  constructor(opt_providers) {
    this._providers = opt_providers || new IMap();
  }

  ctor(name, ctor, opt_options) {
    assert(typeof ctor == 'function', `Cannot provide nonfunction for constructor provider ${ name }`);
    const deps = getDependencyNames(ctor);
    return this._add(name, 'CTOR', ctor, deps, opt_options);
  }

  constant(name, constant) {
    assert(constant != null, `Cannot provide null for constant provider ${ name }`);
    return this._add(name, 'CONSTANT', constant, []);
  }

  fn(name, fn, opt_options) {
    assert(typeof fn == 'function', `Cannot provide nonfunction for function provider ${ name }`);
    const dependencies = getDependencyNames(fn);
    return this._add(name, 'FN', fn, dependencies, opt_options);
  }

  _add(name, type, factory, deps, options = {}) {
    let mappedDeps = deps;
    if (options.using) {
      mappedDeps = deps.map(d => options.using[d] || d);
    }
    const provider = new Provider(name, type, factory, mappedDeps, {
      isCacheable: !!options.isCacheable
    });
    return new Registry(this._providers.set(provider));
  }

  buildInjector() {
    // TODO validate graph with top-sort
    return new Injector(this._providers);
  }
}

/**
 * Parse the dependency names out of a function provider.
 *
 * First checks for named dependencies in the `$ij` field, used in minified
 * contexts. Otherwise attempts to parse the dependencies by name from the
 * function signature, accounting for ES6 classes.
 */
function getDependencyNames(fn) {
  if (fn.$ij && Array.isArray(fn.$ij)) return fn.$ij;

  const fnStr = fn.toString();
  let keywordIdx = 0;

  // If this is an ES6 class
  if (fnStr.startsWith('class')) {
    const ctorMatch = /\bconstructor\b/.exec(fnStr);
    // Empty default constructor
    if (!ctorMatch) return [];
    keywordIdx = ctorMatch.index;
  }

  const leftParenIdx = fnStr.indexOf('(', keywordIdx);
  const rightParenIdx = fnStr.indexOf(')', keywordIdx);
  const paramsStr = fnStr.substring(leftParenIdx + 1, rightParenIdx).trim();
  if (paramsStr === '') return [];

  return params.split(',').map(p => p.trim());
}

/** The descriptor of a provider. */
class Provider {

  /**
   * The list of dependencies required by this Provider, identified by their
   * global names in the Registry.
   */


  /** The type of this provider, used in determining how to build itself. */
  constructor(name, type, factory, deps, opts = {}) {
    this.name = name;
    this.type = type;
    this.factory = factory;
    this.dependencies = deps;
    this.isCacheable = !!opts.isCacheable;
    Object.seal(this);
  }

  /** Whether this Provider's result can be globally cached. */


  /** The actual value of the provider, which can be anything. */

  /** The global name of the Provider as it exists in the Registry. */
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
    this._providers = providers;
    this._cache = new IMap();
  }

  /**
   * Build a dependency from the registry.
   *
   * This method will build a dependency (and its subdependencies) anew each
   * time it's called unless the dependency has specifically indicated that it
   * is cacheable. However it will not build a dependency more than once per
   * call, even if the same dependency is required multiple times.
   */
  build(name) {
    if (!this._providers.has(name)) {
      return Promise.reject(new Error(`Provider not found for ${ name }`));
    }

    const provider = this._providers.get(name);
    return this._build(provider, name).then(results => results.get(provider.name)).catch(err => {
      if (err instanceof ProviderNotFound) {
        err.parents.push(name);
        const chain = err.parents.join(' → ');
        throw new Error(err.message + `(in dependency chain: ${ chain })`);
      }
      throw err;
    });
  }

  _build(provider) {
    if (this._cache.has(provider.name)) {
      return this._cache.get(provider.name);
    }

    const childPromises = provider.dependencies.map(depName => {
      const depProvider = this._providers.get(depName);
      if (!depProvider) {
        // TODO clean up API for parents
        const err = new ProviderNotFound(`Provider not found for ${ depName }`);
        err.parents = [provider.name];
        return Promise.reject(err);
      }

      return this._build(depProvider).catch(err => {
        if (err instanceof ProviderNotFound) {
          err.parents.push(provider.name);
        }
        throw err;
      });
    });

    return Promise.all(childPromises).then(depResults => {
      const results = new IMap().merge(...depResults);
      return this._buildProvider(provider, results).then(result => {
        if (provider.isCacheable) {
          this._cache = this._cache.set(provider.name, result);
        }
        return results.set(provider.name, result);
      });
    });
  }

  _buildProvider(provider, results) {
    const args = provider.dependencies.map(d => results.get(d));
    switch (provider.type) {
      case 'CONSTANT':
        return Promsie.resolve(provider.factory);
      case 'CTOR':
        return Promise.resolve(new provider.factory(...args));
      case 'FN':
        return Promise.resolve(provider.factory(...args));
    }
  }
}

class ProviderNotFound extends Error {

  addParent(name) {
    if (!this._parents) this._parents = [name];else this._parents.push(name);
    return this._parents;
  }

  get parents() {
    return this._parents || [];
  }
}

function assert(val, msg) {
  if (!val) {
    throw new Error(msg);
  }
  return val;
}

export default {
  Registry
};