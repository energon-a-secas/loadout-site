// Render with hostile state and check nothing escapes into markup.
import test from 'node:test'
import assert from 'node:assert/strict'

const els = {}
globalThis.document = {
  getElementById: (id) => (els[id] ||= { innerHTML: '', textContent: '', value: '', dataset: {} }),
  querySelector: () => null,
}
const { state } = await import('../js/state.js')
const { render } = await import('../js/render.js')

const XSS = '"><img src=x onerror=alert(1)>'
const STYLE = 'red;background:url(//evil)'

test('render escapes ids, colours, types and numbers even when state was not validated', () => {
  Object.assign(state, {
    people: [{ id: XSS, name: XSS, color: STYLE }],
    weeks: [{ id: XSS, label: XSS }, { id: 'w2', label: 'two' }],
    currentWeekId: XSS,
    meetings: [{ id: XSS, weekId: XSS, day: 'mon', type: XSS, title: XSS, durationMin: XSS, recurrence: XSS, attendees: [XSS] }],
    settings: { preset: 'custom', thresholdHours: XSS, workHours: 40 },
  })
  render()
  const html = Object.values(els).map(e => e.innerHTML).join('\n')
  assert.ok(html.length > 500)
  assert.ok(!html.includes('<img'), 'no tag is injected')
  assert.ok(!html.includes('onerror=alert(1)">') && !/"\s*onerror/.test(html), 'no attribute breaks out')
  assert.ok(!html.includes('url(//evil)'), 'no hostile style value')
  assert.ok(html.includes('&quot;&gt;&lt;img'), 'the value is shown escaped')
})
