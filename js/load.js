// ════════════════════════════════════════════════════════════
//  load.js — Weighted meeting-hours workload model
//
//  Load is NOT the number of meetings — it's the weekly HOURS those
//  meetings cost, weighted by how often each recurs. Five 15-minute
//  standups must not outweigh three 60-minute customer calls.
//
//     weekHours = Σ  durationMin/60 × recurrenceFactor  (over attended meetings in a week)
//
//  Multi-week: the bottle/ring show a person's AVERAGE weekly hours across
//  all planned weeks (steady-state). Per-week hours drive day totals,
//  tooltips, and per-week overload detection so a spike isn't smoothed away.
// ════════════════════════════════════════════════════════════

import { RECURRENCE, BANDS } from './data.js'

// Weekly meeting-hours a single meeting costs one attendee.
export function meetingWeeklyHours(m) {
  const factor = RECURRENCE[m.recurrence]?.factor ?? 1
  return (Number(m.durationMin) || 0) / 60 * factor
}

// Weekly meeting-hours for one person, restricted to a single week's meetings.
export function personHoursInWeek(personId, meetings, weekId) {
  return meetings.reduce((sum, m) => {
    if (m.weekId !== weekId || !m.attendees.includes(personId)) return sum
    return sum + meetingWeeklyHours(m)
  }, 0)
}

// Average weekly meeting-hours for one person across every planned week.
export function personAvgHours(personId, meetings, weeks) {
  if (!weeks.length) return 0
  const total = meetings.reduce((sum, m) => {
    if (!m.attendees.includes(personId)) return sum
    return sum + meetingWeeklyHours(m)
  }, 0)
  return total / weeks.length
}

// The single week in which a person carries the most load (for spike detection).
export function personPeakWeek(personId, meetings, weeks) {
  let peak = { weekId: null, hours: 0 }
  weeks.forEach(w => {
    const h = personHoursInWeek(personId, meetings, w.id)
    if (h > peak.hours) peak = { weekId: w.id, hours: h, label: w.label }
  })
  return peak
}

// Fraction of the threshold for an arbitrary hours value.
export function fillFor(hours, thresholdHours) {
  if (!thresholdHours) return 0
  return hours / thresholdHours
}

// Band key ('green' | 'amber' | 'red') for a given fill fraction.
export function bandFor(fill) {
  if (fill <= BANDS.green.max) return 'green'
  if (fill <= BANDS.amber.max) return 'amber'
  return 'red'
}

// Meeting-hours cost of a day column within a week (attendee-weighted).
export function dayHours(dayId, meetings, weekId) {
  return meetings
    .filter(m => m.day === dayId && m.weekId === weekId)
    .reduce((sum, m) => sum + meetingWeeklyHours(m) * Math.max(1, m.attendees.length), 0)
}

// Count of distinct meetings a person sits in within a week (for the tooltip / chip).
export function personMeetingCountInWeek(personId, meetings, weekId) {
  return meetings.filter(m => m.weekId === weekId && m.attendees.includes(personId)).length
}
