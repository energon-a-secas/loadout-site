// ════════════════════════════════════════════════════════════
//  validate.js: the one gate for stored and imported state.
//
//  Everything in localStorage is untrusted: another tab, an old build, a
//  browser extension or a hand edit can put anything there, and from the
//  Workspace adoption on, people arrive from a link or a frame too. Every
//  value that later reaches an attribute, a style or a sum passes through
//  here first, and anything that does not fit is dropped or replaced with
//  a default. Pure: no DOM, so Node tests import it directly.
// ════════════════════════════════════════════════════════════

import { DAYS, RECURRENCE, MEETING_TYPES, PRESETS } from './data.js'

// A name holds as much as the Workspace keeps (120), so a person brought in and
// saved straight back reads the same and the save changes nothing.
export const LIMITS = { people: 500, weeks: 52, meetings: 2000, name: 120, week: 24, title: 40 }
export const DURATION = { min: 5, max: 480 }
export const THRESHOLD = { min: 2, max: 20 }
export const WORK_HOURS = { min: 1, max: 168 }

const ID = /^[A-Za-z0-9_-]{1,64}$/
const WS_ID = /^[a-z0-9-]{1,48}$/
const HEX = /^#[0-9a-fA-F]{6}$/
const DAY_IDS = new Set(DAYS.map(d => d.id))
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

export const isMap = v => v !== null && typeof v === 'object' && !Array.isArray(v)

/** An id safe in an attribute and a selector, or ''. */
export function cleanId(v) {
  return typeof v === 'string' && ID.test(v) ? v : ''
}

/** A #rrggbb colour (lowercased), or ''. The only way a colour reaches a style. */
export function cleanColor(v) {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : ''
}

/** Text: control characters dropped, whitespace collapsed, trimmed, capped. */
export function cleanText(v, max) {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(s).slice(0, max).join('').trim()
}

/** A finite number inside [lo, hi], rounded to `step`, or `fallback`. */
export function cleanNumber(v, lo, hi, fallback, step = 1) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  const r = Math.round(n / step) * step
  return Math.min(hi, Math.max(lo, r))
}

const pick = (v, table, fallback) => (typeof v === 'string' && own(table, v) ? v : fallback)
export const cleanType = v => pick(v, MEETING_TYPES, 'custom')
export const cleanRecurrence = (v, fallback = 'weekly') => pick(v, RECURRENCE, fallback)
export const cleanDay = v => (typeof v === 'string' && DAY_IDS.has(v) ? v : 'mon')

/**
 * A stored state object, cleaned. Returns null when `raw` is not an object.
 * `makeId` mints an id for a person, week or meeting whose id is missing,
 * unsafe or already taken; `fallbackColor(i)` colours a person with none.
 */
export function cleanState(raw, { makeId, fallbackColor }) {
  if (!isMap(raw)) return null
  const taken = new Set()
  const claim = (v) => {
    let id = cleanId(v)
    while (!id || taken.has(id)) id = cleanId(makeId())
    taken.add(id)
    return id
  }

  const people = []
  for (const p of Array.isArray(raw.people) ? raw.people.slice(0, LIMITS.people) : []) {
    if (!isMap(p)) continue
    const name = cleanText(p.name, LIMITS.name)
    if (!name) continue
    const person = { id: claim(p.id), name, color: cleanColor(p.color) || fallbackColor(people.length) }
    const ws = typeof p.ws === 'string' && WS_ID.test(p.ws) ? p.ws : ''
    if (ws && !people.some(q => q.ws === ws)) person.ws = ws
    people.push(person)
  }
  const personIds = new Set(people.map(p => p.id))

  const weeks = []
  for (const w of Array.isArray(raw.weeks) ? raw.weeks.slice(0, LIMITS.weeks) : []) {
    if (!isMap(w)) continue
    weeks.push({ id: claim(w.id), label: cleanText(w.label, LIMITS.week) || `Week ${weeks.length + 1}` })
  }
  if (!weeks.length) weeks.push({ id: claim(''), label: 'Week 1' })
  const weekIds = new Set(weeks.map(w => w.id))

  const meetings = []
  for (const m of Array.isArray(raw.meetings) ? raw.meetings.slice(0, LIMITS.meetings) : []) {
    if (!isMap(m)) continue
    const type = cleanType(m.type)
    const t = MEETING_TYPES[type]
    const attendees = []
    for (const a of Array.isArray(m.attendees) ? m.attendees : []) {
      if (typeof a === 'string' && personIds.has(a) && !attendees.includes(a)) attendees.push(a)
    }
    meetings.push({
      id: claim(m.id),
      weekId: typeof m.weekId === 'string' && weekIds.has(m.weekId) ? m.weekId : weeks[0].id,
      day: cleanDay(m.day),
      type,
      title: cleanText(m.title, LIMITS.title),
      durationMin: cleanNumber(m.durationMin, DURATION.min, DURATION.max, t.defaultMin, 5),
      recurrence: cleanRecurrence(m.recurrence, t.defaultRecurrence),
      attendees,
    })
  }

  const s = isMap(raw.settings) ? raw.settings : {}
  const preset = pick(s.preset, PRESETS, 'experienced')
  const settings = {
    preset,
    thresholdHours: cleanNumber(s.thresholdHours, THRESHOLD.min, THRESHOLD.max, PRESETS[preset].thresholdHours),
    workHours: cleanNumber(s.workHours, WORK_HOURS.min, WORK_HOURS.max, PRESETS[preset].workHours, 0.25),
  }

  const currentWeekId = typeof raw.currentWeekId === 'string' && weekIds.has(raw.currentWeekId) ? raw.currentWeekId : weeks[0].id
  return { people, weeks, currentWeekId, meetings, settings }
}
