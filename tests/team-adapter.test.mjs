import test from 'node:test'
import assert from 'node:assert/strict'
import { pickTeam, planAdd, toWorkspace, workspaceId, weeklyHours, face, NO_TEAM_CAP } from '../js/team-adapter.js'
import { normalizeWorkspace, previewMerge, colorFor, initials } from '../js/neorgon-workspace-core.js'

const WS = {
  v: 1,
  me: { person: 'ana-rojas' },
  people: [
    { id: 'ana-rojas', name: 'Ana Rojas' },
    { id: 'kenji-sato', name: 'Kenji Sato', color: '#0f766e' },
    { id: 'lea-muller', name: 'Léa Müller' },
    { id: 'priya-nair', name: 'Priya Nair' },
    { id: 'evil', name: '"><img src=x onerror=alert(1)>', color: 'red;x:url(y)' },
  ],
  teams: [
    { id: 'platform', name: 'Platform', members: [{ person: 'priya-nair' }] },
    { id: 'payments', name: 'Payments', lead: 'ana-rojas', members: [{ person: 'kenji-sato' }, { person: 'lea-muller' }, { person: 'evil' }] },
  ],
}

test('pickTeam: my teams, else the first team, else everyone up to the cap', () => {
  assert.deepEqual(pickTeam(WS).people.map(p => p.id), ['ana-rojas', 'kenji-sato', 'lea-muller', 'evil'])
  assert.deepEqual(pickTeam({ ...WS, me: {} }).people.map(p => p.id), ['priya-nair'])
  const many = { v: 1, people: Array.from({ length: 90 }, (_, i) => ({ id: 'p' + i, name: 'P ' + i })) }
  assert.equal(pickTeam(many).people.length, NO_TEAM_CAP)
  for (const junk of [null, 'x', 1, [], { people: 'no' }]) assert.deepEqual(pickTeam(junk).people, [])
})

test('planAdd: new chips get the kit colour, a same-named chip is linked, nothing twice', () => {
  const roster = [{ id: 'l1', name: 'ana rojas', color: '#f87171' }, { id: 'l2', name: 'Tom' }]
  const plan = planAdd(WS, roster)
  assert.deepEqual(plan.link, [{ id: 'l1', ws: 'ana-rojas' }])
  assert.deepEqual(plan.add.map(a => a.ws), ['kenji-sato', 'lea-muller', 'evil'])
  assert.equal(plan.add[0].color, '#0f766e')
  assert.equal(plan.add[1].color, colorFor({ id: 'lea-muller', name: 'Léa Müller' }))
  assert.match(plan.add[2].color, /^#[0-9a-f]{6}$/, 'a hostile colour never comes through')
  assert.deepEqual(plan.teams, ['Payments'])
  // After adding, a second run adds nobody.
  const after = [{ ...roster[0], ws: 'ana-rojas' }, roster[1], ...plan.add.map((a, i) => ({ id: 'n' + i, ...a }))]
  const again = planAdd(WS, after)
  assert.deepEqual(again.add, [])
  assert.deepEqual(again.link, [])
  assert.equal(again.kept, 4)
})

test('planAdd: two local chips with one name are not guessed at', () => {
  const plan = planAdd(WS, [{ id: 'a', name: 'Ana Rojas' }, { id: 'b', name: 'Ana Rojas' }])
  assert.deepEqual(plan.link, [])
  assert.equal(plan.add[0].ws, 'ana-rojas')
})

test('planAdd respects the roster cap', () => {
  const roster = Array.from({ length: 499 }, (_, i) => ({ id: 'r' + i, name: 'R ' + i }))
  const plan = planAdd(WS, roster)
  assert.equal(plan.add.length, 1)
  assert.equal(plan.skipped, 3)
})

test('toWorkspace: ids round-trip, workspace colours are not overwritten', () => {
  const people = [
    { id: 'mg2x1', name: 'Maya Chen', color: '#f87171' },
    { id: 'n0', name: 'Kenji Sato', color: '#0f766e', ws: 'kenji-sato' },
    { id: 'n1', name: '   ', color: '#000000' },
  ]
  const payload = toWorkspace(people)
  assert.deepEqual(payload, { v: 1, people: [
    { id: 'loadout-mg2x1', name: 'Maya Chen', color: '#f87171' },
    { id: 'kenji-sato', name: 'Kenji Sato' },
  ] })
  const { ws, issues } = normalizeWorkspace(payload)
  assert.equal(issues.length, 0)
  assert.deepEqual(ws.people.map(p => p.id), ['loadout-mg2x1', 'kenji-sato'])
  // Saving twice into a workspace adds nobody the second time.
  const base = normalizeWorkspace(WS).ws
  const once = previewMerge(base, payload).next
  const twice = previewMerge(once, payload)
  assert.deepEqual(twice.added, [])
  assert.equal(twice.next.people.length, once.people.length)
  assert.equal(once.people.find(p => p.id === 'kenji-sato').color, '#0f766e')
})

test('workspaceId is always a workspace slug', () => {
  for (const id of ['ABC', 'a_b', 'x'.repeat(64), '-', '']) {
    const out = workspaceId({ id })
    assert.match(out, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    assert.ok(out.length <= 48)
  }
})

test('weeklyHours: span times work days, with a fallback for junk', () => {
  assert.equal(weeklyHours({ h: [540, 1020], d: '12345' }), 40)
  assert.equal(weeklyHours({ h: [480, 1050], d: '1234' }), 38)
  assert.equal(weeklyHours({ h: [540, 780], d: '135' }), 12)
  assert.equal(weeklyHours({ h: [600, 540], d: '12345' }), 40)
  assert.equal(weeklyHours({ h: [540, 1020], d: '' }), 40)
  assert.equal(weeklyHours(null, 35), 35)
})

test('face: the kit colour and initials', () => {
  assert.deepEqual(face({ name: 'Léa Müller', ws: 'lea-muller' }), { color: colorFor('lea-muller'), initials: initials('Léa Müller') })
  assert.equal(face({ name: 'Maya Chen', color: '#F87171' }).color, '#f87171')
  assert.match(face({ id: 'x', name: 'x', color: 'url(y)' }).color, /^#[0-9a-f]{6}$/)
})
