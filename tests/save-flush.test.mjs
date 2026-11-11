// The debounced save is written at once when the page is hidden or left.
import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.document = { getElementById: () => null, querySelector: () => null }
const { state, STORAGE_KEY, debouncedSave, flushSave, bindSaveFlush } = await import('../js/state.js')

function target() {
  const handlers = {}
  return { handlers, addEventListener: (t, fn) => { (handlers[t] ||= []).push(fn) }, fire: t => (handlers[t] || []).forEach(fn => fn()) }
}

test('flushSave writes a pending save now, and only when one is pending', () => {
  store.clear()
  assert.equal(flushSave(), false)
  state.people = [{ id: 'a', name: 'Ana', color: '#123456' }]
  debouncedSave()
  assert.equal(store.has(STORAGE_KEY), false, 'still waiting')
  assert.equal(flushSave(), true)
  assert.equal(JSON.parse(store.get(STORAGE_KEY)).people[0].name, 'Ana')
  assert.equal(flushSave(), false, 'the timer is gone, nothing writes twice')
})

test('pagehide and a hidden tab flush an edit made just before; a visible tab does not', () => {
  const win = target(), doc = target()
  doc.visibilityState = 'visible'
  bindSaveFlush(win, doc)

  store.clear()
  state.people = [{ id: 'b', name: 'Before reload', color: '#123456' }]
  debouncedSave()
  win.fire('pagehide')
  assert.equal(JSON.parse(store.get(STORAGE_KEY)).people[0].name, 'Before reload')

  store.clear()
  state.people = [{ id: 'c', name: 'Before close', color: '#123456' }]
  debouncedSave()
  doc.fire('visibilitychange')
  assert.equal(store.has(STORAGE_KEY), false, 'visible: the debounce keeps running')
  doc.visibilityState = 'hidden'
  doc.fire('visibilitychange')
  assert.equal(JSON.parse(store.get(STORAGE_KEY)).people[0].name, 'Before close')
})
