// ════════════════════════════════════════════════════════════
//  insights.js — Pure functions that read state and flag problems.
//  Re-run on every change; rendered in the right-side drawer.
//
//  Overload / oversized / duplicate / frequency run PER WEEK, so a spike
//  in one week is caught even when the multi-week average looks calm.
//  Under-load is judged on the average (a chronically light person).
// ════════════════════════════════════════════════════════════

import { MEETING_TYPES } from './data.js'
import { personHoursInWeek, personAvgHours, personMeetingCountInWeek } from './load.js'

// Each insight: { level: 'high'|'medium'|'low', title, detail, weekId? }
export function computeInsights(state) {
  const out = []
  const { people, meetings, weeks, settings } = state
  const threshold = settings.thresholdHours
  const workHours = settings.workHours || 40
  const multiWeek = weeks.length > 1
  const wname = id => weeks.find(w => w.id === id)?.label || 'a week'

  weeks.forEach(week => {
    const wm = meetings.filter(m => m.weekId === week.id)

    // 1. Overloaded people — over the threshold in THIS week.
    people.forEach(p => {
      const h = personHoursInWeek(p.id, meetings, week.id)
      if (h > threshold) {
        const pct = Math.round((h / workHours) * 100)
        out.push({
          level: 'high',
          weekId: week.id,
          title: `${p.name} is overloaded${multiWeek ? ` in ${week.label}` : ''}`,
          detail: `${h.toFixed(1)}h of meetings (${pct}% of a ${workHours}h week), over the ${threshold}h line.`,
        })
      }
    })

    // 3. Oversized meetings — attendee count above the type's sane cap.
    wm.forEach(m => {
      const t = MEETING_TYPES[m.type]
      if (t && m.attendees.length > t.cap) {
        out.push({
          level: 'medium',
          weekId: week.id,
          title: `${label(m)} has ${m.attendees.length} people${multiWeek ? ` (${week.label})` : ''}`,
          detail: `A ${t.label} works best with ${t.cap} or fewer. Trim the guest list or split it.`,
        })
      }
    })

    // 4. Duplicate meetings — same type + same day + overlapping attendees.
    for (let i = 0; i < wm.length; i++) {
      for (let j = i + 1; j < wm.length; j++) {
        const a = wm[i], b = wm[j]
        if (a.type !== b.type || a.day !== b.day) continue
        const overlap = a.attendees.filter(id => b.attendees.includes(id))
        if (overlap.length >= 2 || (overlap.length >= 1 && a.attendees.length <= 2)) {
          out.push({
            level: 'medium',
            weekId: week.id,
            title: `Possible duplicate on ${dayName(a.day)}${multiWeek ? ` (${week.label})` : ''}`,
            detail: `"${label(a)}" and "${label(b)}" are the same type, same day, with shared people. Are you meeting twice?`,
          })
        }
      }
    }

    // 5. Too frequent — multiple recurring syncs of the same type on one person.
    people.forEach(p => {
      const byType = {}
      wm.forEach(m => {
        if (!m.attendees.includes(p.id) || m.recurrence === 'once') return
        byType[m.type] = (byType[m.type] || 0) + 1
      })
      Object.entries(byType).forEach(([type, count]) => {
        if (count >= 3) {
          out.push({
            level: 'low',
            weekId: week.id,
            title: `${p.name}: ${count}× ${MEETING_TYPES[type]?.label}${multiWeek ? ` (${week.label})` : ''}`,
            detail: `${count} recurring ${MEETING_TYPES[type]?.label} meetings on their plate. Are you syncing too often?`,
          })
        }
      })
    })
  })

  // 2. Under-loaded people — chronically light on AVERAGE (only once meetings exist).
  if (meetings.length > 0) {
    people.forEach(p => {
      const avg = personAvgHours(p.id, meetings, weeks)
      if (avg < threshold * 0.25) {
        out.push({
          level: 'low',
          title: `${p.name} is light`,
          detail: avg === 0
            ? `In no meetings across ${multiWeek ? 'any planned week' : 'the week'}. Room to pull them into a sync.`
            : `Averaging only ${avg.toFixed(1)}h a week, well under the ${threshold}h line.`,
        })
      }
    })
  }

  // High severity first; within a level, keep the current week's items on top.
  const rank = { high: 0, medium: 1, low: 2 }
  return out.sort((a, b) => {
    if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level]
    const ac = a.weekId === state.currentWeekId ? 0 : 1
    const bc = b.weekId === state.currentWeekId ? 0 : 1
    return ac - bc
  })
}

function label(m) {
  return m.title || MEETING_TYPES[m.type]?.label || 'Meeting'
}
function dayName(id) {
  return { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' }[id] || id
}
