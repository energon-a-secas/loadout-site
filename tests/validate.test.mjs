// node --test tests/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanState, cleanId, cleanColor, cleanText, cleanNumber, LIMITS } from '../js/validate.js'

let n = 0
const opts = { makeId: () => 'gen' + (++n), fallbackColor: () => '#f87171' }
const XSS = '"><img src=x onerror=alert(1)>'

test('ids, colours and text', () => {
  assert.equal(cleanId('abc-12_Z'), 'abc-12_Z')
  for (const bad of [XSS, '', 'a b', 'x'.repeat(65), 1, null, {}, 'a"b']) assert.equal(cleanId(bad), '')
  assert.equal(cleanColor('#ABCDEF'), '#abcdef')
  for (const bad of ['red', '#abc', 'red;background:url(x)', '#12345g', '#1234567', 0x123456]) assert.equal(cleanColor(bad), '')
  assert.equal(cleanText('  a\u0000b‮ c\n', 40), 'a b c')
  assert.equal(cleanText('x'.repeat(100), 40).length, 40)
  assert.equal(cleanText(42, 40), '')
  assert.equal(cleanNumber('abc', 5, 480, 30), 30)
  assert.equal(cleanNumber(Infinity, 5, 480, 30), 30)
  assert.equal(cleanNumber(1e9, 5, 480, 30, 5), 480)
  assert.equal(cleanNumber(-3, 5, 480, 30), 5)
  assert.equal(cleanNumber(31, 5, 480, 30, 5), 30)
})

test('cleanState refuses non-objects', () => {
  for (const bad of [null, 1, 'x', [], undefined]) assert.equal(cleanState(bad, opts), null)
})

test('cleanState: hostile people, weeks and meetings come out safe', () => {
  const raw = {
    people: [
      { id: XSS, name: 'Ana', color: 'red;background:url(//evil)' },
      { id: 'p2', name: XSS, color: '#00FF00', ws: 'ana-rojas' },
      { id: 'p2', name: 'Dup id' },
      { id: 'p4', name: '   ' },
      'not a person',
      { id: 'p5', name: 'Bo', ws: 'BAD ID' },
    ],
    weeks: [{ id: 'w1', label: XSS }, { id: 'w1', label: 'dup' }, null],
    currentWeekId: XSS,
    meetings: [
      { id: XSS, weekId: 'nope', day: XSS, type: XSS, durationMin: XSS, recurrence: 'nope', attendees: ['p2', 'p2', 'ghost', 7] },
      { id: 'm2', weekId: 'w1', day: 'wed', type: 'oneonone', durationMin: 1e12, recurrence: 'daily', title: 'T'.repeat(99) },
      { id: '__proto__', type: 'constructor', recurrence: 'toString', durationMin: -1 },
    ],
    settings: { preset: '__proto__', thresholdHours: 'x', workHours: 1e9 },
  }
  const s = cleanState(raw, opts)
  const ids = [...s.people, ...s.weeks, ...s.meetings].map(x => x.id)
  assert.equal(new Set(ids).size, ids.length, 'ids are unique')
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,64}$/)
  assert.deepEqual(s.people.map(p => p.name), ['Ana', XSS, 'Dup id', 'Bo'])
  assert.equal(s.people[0].color, '#f87171')
  assert.equal(s.people[1].color, '#00ff00')
  assert.equal(s.people[1].ws, 'ana-rojas')
  assert.equal(s.people[3].ws, undefined)
  assert.equal(s.weeks.length, 2)
  assert.equal(s.currentWeekId, s.weeks[0].id)
  const [a, b, c] = s.meetings
  assert.equal(a.weekId, s.weeks[0].id)
  assert.equal(a.day, 'mon')
  assert.equal(a.type, 'custom')
  assert.equal(a.durationMin, 30)
  assert.equal(a.recurrence, 'weekly')
  assert.deepEqual(a.attendees, ['p2'])
  assert.equal(b.durationMin, 480)
  assert.equal(b.title.length, LIMITS.title)
  assert.equal(c.type, 'custom')
  assert.equal(c.recurrence, 'weekly')
  assert.equal(c.durationMin, 5)
  assert.deepEqual(s.settings, { preset: 'experienced', thresholdHours: 5, workHours: 168 })
})

test('cleanState: an empty object gives one week and defaults', () => {
  const s = cleanState({}, opts)
  assert.equal(s.weeks.length, 1)
  assert.deepEqual(s.people, [])
  assert.deepEqual(s.meetings, [])
  assert.equal(s.settings.preset, 'experienced')
})

test('cleanState: caps', () => {
  const people = Array.from({ length: 900 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))
  const s = cleanState({ people }, opts)
  assert.equal(s.people.length, LIMITS.people)
})

test('cleanState keeps a good save as it was', () => {
  const good = {
    people: [{ id: 'a1', name: 'Maya Chen', color: '#f87171' }],
    weeks: [{ id: 'w1', label: 'Steady week' }],
    currentWeekId: 'w1',
    meetings: [{ id: 'm1', weekId: 'w1', day: 'tue', type: 'daily', title: '', durationMin: 15, recurrence: 'daily', attendees: ['a1'] }],
    settings: { preset: 'custom', thresholdHours: 7, workHours: 40 },
  }
  assert.deepEqual(cleanState(good, opts), good)
})
