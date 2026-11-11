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
  assert.deepEqual(plan.link, [{ id: 'l1', ws: 'ana-rojas', color: colorFor({ id: 'ana-rojas', name: 'Ana Rojas' }) }])
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

test('toWorkspace: ids round-trip, no colour is ever sent', () => {
  const people = [
    { id: 'mg2x1', name: 'Maya Chen', color: '#f87171' },
    { id: 'n0', name: 'Kenji Sato', color: '#0f766e', ws: 'kenji-sato' },
    { id: 'n1', name: '   ', color: '#000000' },
  ]
  const payload = toWorkspace(people)
  assert.deepEqual(payload, { v: 1, people: [
    { id: 'loadout-mg2x1', name: 'Maya Chen' },
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

test('planAdd after a save: a chip merged by name under another id is linked, not copied', () => {
  const ws0 = normalizeWorkspace({ v: 1, me: { person: 'maya-chen' }, people: [{ id: 'maya-chen', name: 'Maya Chen' }, { id: 'kenji', name: 'Kenji Sato' }],
    teams: [{ id: 't', name: 'T', lead: 'maya-chen', members: [{ person: 'kenji' }] }] }).ws
  const roster = [{ id: 'abc1', name: 'Maya Chen', color: '#336699' }]
  const saved = previewMerge(ws0, toWorkspace(roster))
  assert.deepEqual(saved.added, [], 'the review matched her by name')
  const plan = planAdd(saved.next, roster)
  assert.deepEqual(plan.link, [{ id: 'abc1', ws: 'maya-chen', color: colorFor({ id: 'maya-chen', name: 'Maya Chen' }) }])
  assert.deepEqual(plan.add.map(a => a.ws), ['kenji'])
  // A chip an older build tied to its made-up id (or "Not now") is loose, and links the same way.
  const stale = planAdd(saved.next, [{ ...roster[0], ws: 'loadout-abc1' }])
  assert.deepEqual(stale.link.map(l => l.ws), ['maya-chen'])
  assert.equal(stale.add.length, 1)
})

test('planAdd after a save that added the chip: linked by the id it was saved under', () => {
  const ws0 = normalizeWorkspace({ v: 1, people: [{ id: 'kenji', name: 'Kenji Sato' }], teams: [{ id: 't', name: 'T', members: [{ person: 'kenji' }] }] }).ws
  const roster = [{ id: 'abc1', name: 'Maya Chen' }, { id: 'abc2', name: 'Maya Chen' }]
  const next = previewMerge(ws0, toWorkspace(roster)).next
  next.teams[0].members.push({ person: 'loadout-abc1' }, { person: 'loadout-abc2' })
  const plan = planAdd(next, roster)
  assert.deepEqual(plan.add.map(a => a.ws), ['kenji'], 'two homonyms are told apart by their saved ids')
  assert.deepEqual(plan.link.map(l => [l.id, l.ws]), [['abc1', 'loadout-abc1'], ['abc2', 'loadout-abc2']])
})

test('weeklyHours stays inside the range a reload accepts', () => {
  assert.equal(weeklyHours({ h: [540, 555], d: '1' }), 1)
  assert.equal(weeklyHours({ h: [0, 1439], d: '1234567' }), 168)
})

test('a long name brought in and saved straight back changes nothing', () => {
  const long = 'Maria de los Angeles Fernandez-Gutierrez Castillo'
  const huge = 'N'.repeat(60) + ' ' + 'M'.repeat(59)
  const ws0 = normalizeWorkspace({ v: 1, me: { person: 'long' }, people: [{ id: 'long', name: long }, { id: 'huge', name: huge }],
    teams: [{ id: 't', name: 'T', lead: 'long', members: [{ person: 'huge' }] }] }).ws
  assert.equal(ws0.people[1].name.length, 120)
  const plan = planAdd(ws0, [])
  assert.deepEqual(plan.add.map(a => a.name), [long, huge], 'names keep every character the workspace keeps')
  const roster = plan.add.map((a, i) => ({ id: 'r' + i, ...a }))
  const merged = previewMerge(ws0, toWorkspace(roster))
  assert.deepEqual([merged.added, merged.updated], [[], []])
})

test('a Loadout chip merged by name never repaints the workspace person', () => {
  const ws0 = normalizeWorkspace({ v: 1, people: [{ id: 'maya-chen', name: 'Maya Chen', color: '#123456' }] }).ws
  const merged = previewMerge(ws0, toWorkspace([{ id: 's1', name: 'Maya Chen', color: '#f87171' }]))
  assert.deepEqual([merged.added, merged.updated], [[], []])
  assert.equal(merged.next.people[0].color, '#123456')
})

test('confirmAddText: asks only above 40 people, and says how many', async () => {
  const { confirmAddText, CONFIRM_OVER } = await import('../js/team-adapter.js')
  assert.equal(CONFIRM_OVER, 40)
  const plan = n => ({ add: Array.from({ length: n }, (_, i) => ({ ws: 'p' + i })), teams: ['Everyone'] })
  assert.equal(confirmAddText(plan(40)), null)
  assert.equal(confirmAddText({ add: [], teams: [] }), null)
  assert.equal(confirmAddText(null), null)
  const q = confirmAddText(plan(400))
  assert.match(q, /\b400 people from Everyone\b/)
  assert.match(confirmAddText({ add: plan(41).add, teams: [] }), /^Add 41 people to this board\?/)
  // planAdd on a 400-person team does produce a plan that asks.
  const big = { v: 1, people: Array.from({ length: 400 }, (_, i) => ({ id: 'p' + i, name: 'P ' + i })), teams: [{ id: 'all', name: 'All', members: Array.from({ length: 400 }, (_, i) => ({ person: 'p' + i })) }] }
  assert.match(confirmAddText(planAdd(big, [])), /^Add 400 people from All/)
})

test('fmtClock: follows the time format, the device when unset', async () => {
  const { fmtClock } = await import('../js/team-adapter.js')
  assert.equal(fmtClock(540, 'h23'), '09:00')
  assert.equal(fmtClock(1050, 'h23'), '17:30')
  assert.equal(fmtClock(1050, 'h12'), '5:30 pm')
  assert.equal(fmtClock(540, 'h12'), '9:00 am')
  assert.equal(fmtClock(0, 'h12'), '12:00 am')
  assert.equal(fmtClock(720, 'h12'), '12:00 pm')
  assert.equal(fmtClock(1440, 'h23'), '24:00')
  assert.equal(fmtClock(1440, 'h12'), '12:00 am')
  assert.equal(fmtClock(1050, '', 'h12'), '5:30 pm')
  assert.equal(fmtClock(1050, '', 'h23'), '17:30')
  assert.equal(fmtClock(1050, '', 'h11'), '5:30 pm')
})
