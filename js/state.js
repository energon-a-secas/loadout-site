// ════════════════════════════════════════════════════════════
//  state.js — Shared mutable state, persistence, undo history.
//  Multi-week: the roster and settings are global; meetings belong
//  to a week (weekId). You view/edit one week at a time.
// ════════════════════════════════════════════════════════════

import { genId, debounce } from './utils.js'
import { PRESETS, MEETING_TYPES, CLASS_COLORS } from './data.js'

export const STORAGE_KEY = 'loadout-v1'

function makeWeek(label) { return { id: genId(), label } }

// Single shared, mutated-in-place state object (imported by every module).
export const state = {
  people:   [],                 // { id, name, color }
  weeks:    [makeWeek('Week 1')],
  currentWeekId: null,          // set just below
  meetings: [],                 // { id, weekId, day, type, title, durationMin, recurrence, attendees:[personId] }
  settings: {
    preset: 'experienced',
    thresholdHours: PRESETS.experienced.thresholdHours,
    workHours: PRESETS.experienced.workHours,
  },
}
state.currentWeekId = state.weeks[0].id

// Transient UI state — never persisted.
export const ui = {
  drawerOpen: false,
  pickedPersonId: null, // keyboard "carry" selection
}

// ── People ───────────────────────────────────────────────────
let _colorIdx = 0
export function addPerson(name) {
  const person = {
    id: genId(),
    name: String(name).trim().slice(0, 40),
    color: CLASS_COLORS[_colorIdx++ % CLASS_COLORS.length],
  }
  state.people.push(person)
  return person
}

export function removePerson(id) {
  state.people = state.people.filter(p => p.id !== id)
  // Drop them from every meeting they were seated in, across all weeks.
  state.meetings.forEach(m => { m.attendees = m.attendees.filter(a => a !== id) })
}

export function getPerson(id) { return state.people.find(p => p.id === id) }

// ── Weeks ────────────────────────────────────────────────────
export function currentWeekMeetings() {
  return state.meetings.filter(m => m.weekId === state.currentWeekId)
}

// Add a week. Pass a source weekId to clone its meetings (fresh ids) so a
// stable cadence carries over and you only tweak what changes.
export function addWeek(copyFromId = null) {
  const wk = makeWeek(`Week ${state.weeks.length + 1}`)
  state.weeks.push(wk)
  if (copyFromId) {
    state.meetings
      .filter(m => m.weekId === copyFromId)
      .forEach(src => state.meetings.push({
        ...src, id: genId(), weekId: wk.id, attendees: [...src.attendees],
      }))
  }
  state.currentWeekId = wk.id
  return wk
}

export function removeWeek(weekId) {
  if (state.weeks.length <= 1) return false // always keep one week
  const idx = state.weeks.findIndex(w => w.id === weekId)
  state.weeks = state.weeks.filter(w => w.id !== weekId)
  state.meetings = state.meetings.filter(m => m.weekId !== weekId)
  if (state.currentWeekId === weekId) {
    state.currentWeekId = state.weeks[Math.min(idx, state.weeks.length - 1)].id
  }
  return true
}

export function renameWeek(weekId, label) {
  const w = state.weeks.find(w => w.id === weekId)
  if (w) w.label = String(label).trim().slice(0, 24) || w.label
}

export function setCurrentWeek(weekId) {
  if (state.weeks.some(w => w.id === weekId)) state.currentWeekId = weekId
}

// ── Meetings ─────────────────────────────────────────────────
export function addMeeting(day, type) {
  const t = MEETING_TYPES[type] || MEETING_TYPES.custom
  const meeting = {
    id: genId(),
    weekId: state.currentWeekId,
    day,
    type,
    title: '',
    durationMin: t.defaultMin,
    recurrence: t.defaultRecurrence,
    attendees: [],
  }
  state.meetings.push(meeting)
  return meeting
}

export function removeMeeting(id) {
  state.meetings = state.meetings.filter(m => m.id !== id)
}

export function getMeeting(id) { return state.meetings.find(m => m.id === id) }

// Seat a person on a meeting (no duplicates). Returns true if newly seated.
export function seatPerson(meetingId, personId) {
  const m = getMeeting(meetingId)
  if (!m || m.attendees.includes(personId)) return false
  m.attendees.push(personId)
  return true
}

export function unseatPerson(meetingId, personId) {
  const m = getMeeting(meetingId)
  if (!m) return
  m.attendees = m.attendees.filter(a => a !== personId)
}

// ── Settings ─────────────────────────────────────────────────
export function applyPreset(presetKey) {
  const p = PRESETS[presetKey]
  if (!p) return
  state.settings.preset = presetKey
  state.settings.thresholdHours = p.thresholdHours
  state.settings.workHours = p.workHours
}

export function setThreshold(hours) {
  state.settings.thresholdHours = hours
  state.settings.preset = 'custom' // hand-tuning flips off the named preset
}

export function resetAll() {
  state.people = []
  state.meetings = []
  state.weeks = [makeWeek('Week 1')]
  state.currentWeekId = state.weeks[0].id
  applyPreset('experienced')
  history.length = 0
  _colorIdx = 0
}

// ── Persistence ──────────────────────────────────────────────
export function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      people: state.people,
      weeks: state.weeks,
      currentWeekId: state.currentWeekId,
      meetings: state.meetings,
      settings: state.settings,
    }))
  } catch (_) {}
}
export const debouncedSave = debounce(saveState, 300)

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)

    if (Array.isArray(data.people)) state.people = data.people

    // Weeks — migrate pre-multi-week saves by synthesizing a single week.
    state.weeks = (Array.isArray(data.weeks) && data.weeks.length)
      ? data.weeks
      : [makeWeek('Week 1')]
    const firstWeekId = state.weeks[0].id

    if (Array.isArray(data.meetings)) {
      state.meetings = data.meetings.map(m => ({
        id: m.id || genId(),
        weekId: m.weekId && state.weeks.some(w => w.id === m.weekId) ? m.weekId : firstWeekId,
        day: m.day || 'mon',
        type: m.type || 'custom',
        title: m.title || '',
        durationMin: Number(m.durationMin) || (MEETING_TYPES[m.type]?.defaultMin ?? 30),
        recurrence: m.recurrence || (MEETING_TYPES[m.type]?.defaultRecurrence ?? 'weekly'),
        attendees: Array.isArray(m.attendees) ? m.attendees : [],
      }))
    }

    state.currentWeekId = data.currentWeekId && state.weeks.some(w => w.id === data.currentWeekId)
      ? data.currentWeekId
      : firstWeekId

    if (data.settings) Object.assign(state.settings, data.settings)
    _colorIdx = state.people.length // keep the color cursor ahead of restored people
  } catch (_) {}
}

// ── Undo history (snapshot on structural change) ─────────────
const history = []
const MAX_HISTORY = 40

export function snapshot() {
  history.push(JSON.stringify({
    people: state.people, weeks: state.weeks, currentWeekId: state.currentWeekId,
    meetings: state.meetings, settings: state.settings,
  }))
  if (history.length > MAX_HISTORY) history.shift()
}

export function undo() {
  if (!history.length) return false
  const prev = JSON.parse(history.pop())
  state.people = prev.people
  state.weeks = prev.weeks
  state.currentWeekId = prev.currentWeekId
  state.meetings = prev.meetings
  state.settings = prev.settings
  return true
}
