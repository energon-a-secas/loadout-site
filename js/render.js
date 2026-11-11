// ════════════════════════════════════════════════════════════
//  render.js: Builds week tabs, roster, board, blocks, meters, drawer.
// ════════════════════════════════════════════════════════════

import { state, ui, currentWeekMeetings } from './state.js'
import { DAYS, MEETING_TYPES, RECURRENCE } from './data.js'
import { escHtml, fmtHours, clamp } from './utils.js'
import {
  personAvgHours, personHoursInWeek, fillFor, bandFor,
  personMeetingCountInWeek, meetingWeeklyHours, dayHours,
} from './load.js'
import { computeInsights } from './insights.js'
import { cleanColor } from './validate.js'
import { face } from './team-adapter.js'

// Every interpolated value is escaped, ids and numbers included: state is
// validated on load, and this is the second wall, not the first.
const esc = escHtml
const NEUTRAL = '#94a3b8'
const colorOf = (p) => face(p).color
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function render() {
  renderWeekTabs()
  renderRoster()
  renderBoard()
  renderInsights()
  renderSettings()
}

// ── Week tabs ────────────────────────────────────────────────
export function renderWeekTabs() {
  const bar = document.getElementById('weekTabs')
  if (!bar) return
  const multi = state.weeks.length > 1
  bar.innerHTML = state.weeks.map(w => {
    const active = w.id === state.currentWeekId
    const count = state.meetings.filter(m => m.weekId === w.id).length
    const meetings = `${count} meeting${count === 1 ? '' : 's'}`
    return `
      <span class="week-tab-wrap">
        <button type="button" class="week-tab ${active ? 'week-tab--active' : ''}" data-week="${esc(w.id)}"
                title="${active ? `Rename ${escHtml(w.label)}` : `${escHtml(w.label)}: ${meetings}`}"
                aria-pressed="${active}" aria-label="${escHtml(w.label)}, ${meetings}${active ? ', current week. Press to rename.' : ''}">
          <span class="week-tab-label" data-rename-week="${esc(w.id)}">${escHtml(w.label)}</span>
          ${count ? `<span class="week-tab-count" aria-hidden="true">${count}</span>` : ''}
        </button>
        ${active && multi ? `<button type="button" class="week-tab-x" data-remove-week="${esc(w.id)}" aria-label="Delete ${escHtml(w.label)}" title="Delete ${escHtml(w.label)}">×</button>` : ''}
      </span>`
  }).join('') + `
    <button type="button" class="week-add" id="dupWeekBtn" title="Copy this week's meetings into a new week">Duplicate week</button>
    <button type="button" class="week-add" id="addWeekBtn" title="Add a blank week">+ Week</button>`
}

// ── Roster (left party rail) ─────────────────────────────────
export function renderRoster() {
  const list = document.getElementById('rosterList')
  if (!list) return
  const { meetings, weeks, settings } = state
  const multi = weeks.length > 1

  if (!state.people.length) {
    list.innerHTML = `
      <div class="roster-empty">
        <p>Nobody on the board yet. Type a name below, add your team from Settings, or try the sample to see how load builds up.</p>
        <div class="empty-actions">
          <button type="button" class="btn btn--ghost btn--sm" data-empty="sample">Load the sample team</button>
          <button type="button" class="btn btn--ghost btn--sm" data-empty="settings">Add my team</button>
        </div>
      </div>`
    return
  }

  list.innerHTML = state.people.map(p => {
    // Ring + label reflect the AVERAGE across all weeks (steady state).
    const avg = personAvgHours(p.id, meetings, weeks)
    const fill = fillFor(avg, settings.thresholdHours)
    const band = bandFor(fill)
    // Current-week figures for the tooltip / secondary line.
    const wkHours = personHoursInWeek(p.id, meetings, state.currentWeekId)
    const wkCount = personMeetingCountInWeek(p.id, meetings, state.currentWeekId)
    const picked = ui.pickedPersonId === p.id
    const deg = clamp(fill, 0, 1) * 360
    const ringColor = band === 'green' ? 'var(--load-green)' : band === 'amber' ? 'var(--load-amber)' : 'var(--load-red)'
    const avgLabel = multi ? `avg ${fmtHours(avg)}` : fmtHours(avg)
    return `
      <div class="chip ${picked ? 'chip--picked' : ''}" data-person="${esc(p.id)}" draggable="false"
           title="${escHtml(p.name)}: ${avgLabel}/wk${multi ? ` · this week ${fmtHours(wkHours)}` : ''} across ${wkCount} meeting${wkCount === 1 ? '' : 's'}">
        <button type="button" class="chip-main" data-person="${esc(p.id)}" aria-pressed="${picked}"
                aria-label="${escHtml(p.name)}, ${multi ? `averaging ${avg.toFixed(1)} hours a week` : `${avg.toFixed(1)} hours`}, ${wkHours.toFixed(1)} this week in ${wkCount} meetings. ${picked ? 'Picked up. Press Enter on a meeting to seat.' : 'Press Enter to pick up.'}">
          <span class="chip-ring" style="--ring-deg:${deg}deg; --ring-color:${ringColor}; --class-color:${colorOf(p)}">
            <span class="chip-avatar" style="--class-color:${colorOf(p)}">${escHtml(face(p).initials)}</span>
          </span>
          <span class="chip-meta">
            <span class="chip-name">${escHtml(p.name)}</span>
            <span class="chip-load chip-load--${band}">${avgLabel} · ${wkCount} mtg${wkCount === 1 ? '' : 's'}</span>
          </span>
          ${band === 'red' ? '<span class="chip-pip" aria-hidden="true">!</span>' : ''}
        </button>
        <button type="button" class="chip-remove" data-remove-person="${esc(p.id)}" aria-label="Remove ${escHtml(p.name)}" title="Remove">×</button>
      </div>`
  }).join('')
}

// ── Board (Mon–Fri columns for the current week) ─────────────
export function renderBoard() {
  const board = document.getElementById('board')
  if (!board) return
  const meetings = currentWeekMeetings()

  board.innerHTML = DAYS.map(day => {
    const dayMeetings = meetings.filter(m => m.day === day.id)
    const dh = dayHours(day.id, state.meetings, state.currentWeekId)
    return `
      <section class="day" data-day="${day.id}" aria-label="${day.label}">
        <header class="day-head">
          <span class="day-name">${day.label}</span>
          <span class="day-total" title="Total attendee-hours booked this day">${fmtHours(dh)}</span>
        </header>
        <div class="day-drop" data-day="${day.id}">
          ${dayMeetings.map(renderBlock).join('') || `<div class="day-empty">Nothing booked on ${day.label} yet.</div>`}
        </div>
        <button class="day-add" data-add-meeting="${day.id}" aria-label="Add meeting to ${day.label}">+ meeting</button>
      </section>`
  }).join('')
}

function renderBlock(m) {
  const t = MEETING_TYPES[m.type] || MEETING_TYPES.custom
  const rec = RECURRENCE[m.recurrence] || RECURRENCE.weekly
  const perHead = meetingWeeklyHours(m)
  const seats = m.attendees.map(id => {
    const p = state.people.find(pp => pp.id === id)
    if (!p) return ''
    return `<span class="seat" style="--class-color:${colorOf(p)}" title="${escHtml(p.name)}" data-seat="${esc(m.id)}:${esc(p.id)}">${escHtml(face(p).initials)}<button class="seat-x" data-unseat="${esc(m.id)}:${esc(p.id)}" aria-label="Remove ${escHtml(p.name)}">×</button></span>`
  }).join('')
  const oversized = m.attendees.length > t.cap
  return `
    <article class="block ${oversized ? 'block--oversized' : ''}" data-meeting="${esc(m.id)}" data-type="${esc(m.type)}"
             tabindex="0" role="group"
             style="--type-color:${cleanColor(t.color) || NEUTRAL}" aria-label="${escHtml(m.title || t.label)} meeting, ${m.attendees.length} attending. When a teammate is picked up, press Enter to seat them here.">
      <span class="block-notch" aria-hidden="true"></span>
      <div class="block-head">
        <span class="block-glyph" aria-hidden="true">${t.glyph}</span>
        <button type="button" class="block-title" data-edit-title="${esc(m.id)}" title="Rename" aria-label="Rename ${escHtml(m.title || t.label)}">${escHtml(m.title || t.label)}</button>
        <button class="block-x" data-remove-meeting="${esc(m.id)}" aria-label="Delete meeting">×</button>
      </div>
      <div class="block-meta">
        <button class="chiplet" data-cycle-dur="${esc(m.id)}" title="Change duration" aria-label="Duration ${num(m.durationMin)} minutes. Press to change.">${num(m.durationMin)}m</button>
        <button class="chiplet" data-cycle-rec="${esc(m.id)}" title="Change cadence" aria-label="Cadence ${escHtml(rec.label)}. Press to change.">${rec.short}</button>
        <span class="chiplet chiplet--ghost" title="Weekly cost per attendee">${fmtHours(perHead)}/head</span>
      </div>
      <div class="block-seats" data-seats="${esc(m.id)}">
        ${seats || '<span class="seats-empty">Nobody yet. Drag a teammate here, or pick one and press this meeting.</span>'}
      </div>
      <span class="block-tab" aria-hidden="true"></span>
    </article>`
}

// ── Insight drawer: bottle wall (average) + signals ──────────
export function renderInsights() {
  const list = document.getElementById('insightList')
  const badge = document.getElementById('insightBadge')
  if (!list) return
  const insights = computeInsights(state)

  if (badge) {
    const high = insights.filter(i => i.level === 'high').length
    badge.textContent = insights.length
    badge.dataset.high = high > 0 ? '1' : '0'
    badge.hidden = insights.length === 0
  }

  const bottles = state.people.map(p => bottleFor(p)).join('')
  const multi = state.weeks.length > 1
  const wallLabel = multi ? 'Average weekly load' : 'Weekly load'

  const items = insights.length
    ? insights.map(i => `
        <li class="insight insight--${i.level}">
          <span class="insight-dot" aria-hidden="true"></span>
          <div>
            <div class="insight-title">${escHtml(i.title)}</div>
            <div class="insight-detail">${escHtml(i.detail)}</div>
          </div>
        </li>`).join('')
    : !state.people.length || !state.meetings.length
      ? `<li class="insight insight--ok"><div><div class="insight-title">Nothing to read yet</div><div class="insight-detail">Signals appear once teammates sit in meetings. Add people, add a meeting with + meeting, then seat them.</div></div></li>`
      : `<li class="insight insight--ok"><div><div class="insight-title">All balanced</div><div class="insight-detail">No overloads, duplicates, or oversized meetings across your planned weeks.</div></div></li>`

  list.innerHTML = `
    <div class="bottle-wall" aria-label="Team workload bottles">
      ${bottles || '<p class="roster-empty">Each teammate gets a bottle here that fills with their weekly meeting hours.</p>'}
    </div>
    ${state.people.length ? `<p class="wall-caption">${wallLabel} vs ${num(state.settings.thresholdHours)}h threshold</p>` : ''}
    <h3 class="drawer-subhead">Signals</h3>
    <ul class="insight-items">${items}</ul>`
}

function bottleFor(p) {
  const avg = personAvgHours(p.id, state.meetings, state.weeks)
  const fill = fillFor(avg, state.settings.thresholdHours)
  const band = bandFor(fill)
  const pct = clamp(fill, 0, 1.15) * 100
  const over = fill > 1
  const multi = state.weeks.length > 1
  return `
    <div class="bottle ${over ? 'bottle--over' : ''}" title="${escHtml(p.name)}, ${multi ? 'avg ' : ''}${fmtHours(avg)} of ${num(state.settings.thresholdHours)}h">
      <div class="bottle-glass">
        <div class="bottle-liquid bottle-liquid--${band}" style="height:${Math.min(pct, 100)}%"></div>
        <div class="bottle-threshold" aria-hidden="true"></div>
        ${over ? '<div class="bottle-splash" aria-hidden="true"></div>' : ''}
      </div>
      <span class="bottle-name">${escHtml(face(p).initials)}</span>
    </div>`
}

// ── Settings (preset selector + threshold slider) ────────────
export function renderSettings() {
  const sel = document.getElementById('presetSelect')
  const range = document.getElementById('thresholdRange')
  const val = document.getElementById('thresholdVal')
  if (sel) sel.value = state.settings.preset
  if (range) range.value = state.settings.thresholdHours
  if (val) val.textContent = `${state.settings.thresholdHours}h/wk`
}
