const test = require('ava')

const ij = require('./index')

test('Registry#ctor() fails if not a function', t => {
  const r = new ij.Registry()
  const A = {}
  t.throws(() => { r.ctor('a', A) })
})

test('Registry#fn() fails if not a function', t => {
  const r = new ij.Registry()
  const a = {}
  t.throws(() => { r.fn('a', a) })
})

test('Registry#constant() fails if null', t => {
  const r = new ij.Registry()
  const a = null
  t.throws(() => { r.constant('a', a) })
})

test('Registry#constant() fails if null', t => {
  const r = new ij.Registry()
  const a = undefined
  t.throws(() => { r.constant('a', a) })
})
