/**
 * 客户端半边的冒烟测试：不经浏览器，直接把 client.js 当模块跑一遍。
 *
 * 验的是三件最容易出错的事：
 *   1. bundle 真的调用了 window.__ModuleLoader__.load({id, factory})；
 *   2. factory 返回的对象带 inject: ['slots'] 和 apply 函数；
 *   3. apply(ctx) 会往 plugins.bundle.config 注册 key = 'dsh-bili-share'。
 *
 * 渲染逻辑（React 组件）不在这里测 —— 那需要真浏览器。
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))

const fakeReact = {
  createElement: (...args) => ({ type: args[0] }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(options) {
      captured = options
    },
  },
}

await import(new URL('../client.js', import.meta.url).href)

assert.ok(captured, '没有调用 window.__ModuleLoader__.load')
assert.equal(captured.id, 'dsh-bili-share')

const exported = captured.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`未预期的 require：${name}`)
})

assert.ok(Array.isArray(exported.inject) && exported.inject.includes('slots'), 'inject 缺 slots')
assert.equal(typeof exported.apply, 'function')

const registered = []
const ctx = {
  slots: {
    inject(name, thunk) {
      assert.equal(name, 'plugins.bundle.config')
      thunk()
    },
    register(spec, component) {
      registered.push({ spec, component })
    },
  },
  get() {
    return undefined
  },
  effect() {},
}

exported.apply(ctx)

assert.equal(registered.length, 1, '应该只注册一个 slot 单元')
assert.equal(registered[0].spec.name, 'plugins.bundle.config')
assert.equal(registered[0].spec.key, 'dsh-bili-share')
assert.equal(typeof registered[0].component, 'function')

console.log('client-smoke ok：bundle 加载 → inject slots → 注册 plugins.bundle.config(dsh-bili-share)')
console.log(`client.js = ${join(here, '..', 'client.js')}`)
