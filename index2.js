/** @flow */
'use strict'

import immutable from 'immutable'

class Registry {
  _providers: immutable.Map<string, Provider>;

  constructor() {
    this._providers = new immutable.Map()
  }



}
