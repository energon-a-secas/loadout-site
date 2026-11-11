// ════════════════════════════════════════════════════════════
//  team-adapter.js: Loadout's people to the Neorgon Workspace and back.
//  Pure: no DOM, no state import, so Node tests run it directly.
//
//  A workspace is untrusted until normalizeWorkspace has read it, so every
//  function here normalizes first, whatever it was handed.
// ════════════════════════════════════════════════════════════

import { normalizeWorkspace, colorFor, initials as wsInitials, foldName } from './neorgon-workspace-core.js'
import { cleanText, cleanColor, cleanNumber, LIMITS, WORK_HOURS } from './validate.js'

/** How many people "Add my team" brings onto a board when no team says who. */
export const NO_TEAM_CAP = 40
const PREFIX = 'loadout-'

/**
 * Who "Add my team" means: the teams the visitor (`me.person`) is in, else
 * the first team, else everyone up to NO_TEAM_CAP. Workspace order is kept.
 */
export function pickTeam(raw) {
  const { ws } = normalizeWorkspace(raw)
  const byId = new Map(ws.people.map(p => [p.id, p]))
  const me = ws.me && ws.me.person
  let teams = me ? ws.teams.filter(t => t.lead === me || t.members.some(m => m.person === me)) : []
  if (!teams.length && ws.teams.length) teams = [ws.teams[0]]
  if (!teams.length) return { people: ws.people.slice(0, NO_TEAM_CAP), teams: [] }
  const ids = []
  for (const t of teams) {
    for (const id of [t.lead, ...t.members.map(m => m.person)]) if (id && !ids.includes(id)) ids.push(id)
  }
  return { people: ids.map(id => byId.get(id)).filter(Boolean), teams: teams.map(t => t.name) }
}

/**
 * The changes "Add my team" makes to a roster, without making them.
 *   add:  [{ ws, name, color }] new chips, coloured as every tool colours them
 *   link: [{ id, ws, color }]   a chip already on the board, now tied to its person
 *                               and wearing the colour every tool gives them
 *   kept: number                people already on the board
 *
 * A chip counts as tied only when its `ws` names a person this workspace holds.
 * Any other chip is loose and is linked by the id Loadout saves it under, else
 * by a name exactly one loose chip carries. A save can merge a chip into a
 * person by name under that person's own id, so the chip's saved id is a hint,
 * never a fact; trusting it is how "Add my team" used to add a second copy.
 */
export function planAdd(rawWs, roster, cap = LIMITS.people) {
  const { ws } = normalizeWorkspace(rawWs)
  const { people, teams } = pickTeam(ws)
  const known = new Set(ws.people.map(p => p.id))
  const add = [], link = []
  let kept = 0
  const linked = new Set()
  const byId = new Map(), byName = new Map(), names = new Map()
  for (const p of roster) {
    if (p.ws && known.has(p.ws)) { linked.add(p.ws); continue }
    byId.set(workspaceId(p), p)
    const key = foldName(p.name)
    names.set(key, (names.get(key) || 0) + 1)
    byName.set(key, p)
  }
  const used = new Set()
  let room = Math.max(0, cap - roster.length)
  for (const person of people) {
    if (linked.has(person.id)) { kept++; continue }
    const key = foldName(person.name)
    let local = byId.get(person.id)
    if (!local || used.has(local)) local = names.get(key) === 1 ? byName.get(key) : null
    if (local && !used.has(local)) {
      link.push({ id: local.id, ws: person.id, color: colorFor(person) })
      used.add(local)
      linked.add(person.id)
      kept++
      continue
    }
    if (!room) break
    const name = cleanText(person.name, LIMITS.name)
    if (!name) continue
    add.push({ ws: person.id, name, color: colorFor(person) })
    linked.add(person.id)
    room--
  }
  return { add, link, kept, teams, skipped: people.length - add.length - kept }
}

/** A Loadout person's id in the workspace: the one it came with, else `loadout-<id>`. */
export function workspaceId(p) {
  if (p.ws) return p.ws
  const local = String(p.id || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return (PREFIX + local).slice(0, 48).replace(/-+$/, '')
}

/**
 * The save payload: the board's people, by id and name only. Loadout never
 * sends a colour: its chips are coloured from a palette as they are added, not
 * by the visitor, and a chip made here can be merged by name into a workspace
 * person, whose own colour must survive the save. A person new to the
 * workspace takes the colour every tool derives from their id.
 */
export function toWorkspace(people) {
  const out = []
  for (const p of people) {
    const name = cleanText(p.name, LIMITS.name)
    if (!name) continue
    out.push({ id: workspaceId(p), name })
  }
  return { v: 1, people: out }
}

/**
 * Weekly working hours from the visitor's settings: the day's span times the
 * work days, inside the range the stored state accepts (so a reload never
 * reads back a different number than the one in use).
 */
export function weeklyHours(prefs, fallback = 40) {
  const h = prefs && Array.isArray(prefs.h) ? prefs.h : null
  const d = prefs && typeof prefs.d === 'string' ? prefs.d : ''
  if (!h || h.length !== 2 || !Number.isFinite(h[0]) || !Number.isFinite(h[1]) || h[1] <= h[0]) return fallback
  const days = new Set(d.split('').filter(c => c >= '1' && c <= '7')).size
  if (!days) return fallback
  return cleanNumber(((h[1] - h[0]) / 60) * days, WORK_HOURS.min, WORK_HOURS.max, fallback, 0.25)
}

/** The colour and initials a chip shows: the kit's for a workspace person, so every tool agrees. */
export function face(p) {
  return {
    color: cleanColor(p.color) || colorFor(p.ws || p.id || ''),
    initials: wsInitials(p.name),
  }
}
