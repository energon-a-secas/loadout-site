// ════════════════════════════════════════════════════════════
//  render.js — Builds week tabs, roster, board, blocks, meters, drawer.
// ════════════════════════════════════════════════════════════

import { state, ui, currentWeekMeetings } from './state.js'
import { DAYS, MEETING_TYPES, RECURRENCE } from './data.js'
import { escHtml, initials, fmtHours, clamp } from './utils.js'
import {
  personAvgHours, personHoursInWeek, fillFor, bandFor,
  personMeetingCountInWeek, meetingWeeklyHours, dayHours,
} from './load.js'
import { computeInsights } from './insights.js'

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
    return `
      <button class="week-tab ${active ? 'week-tab--active' : ''}" data-week="${w.id}"
              title="${escHtml(w.label)}: ${count} meeting${count === 1 ? '' : 's'}"
              aria-pressed="${active}">
        <span class="week-tab-label" data-rename-week="${w.id}">${escHtml(w.label)}</span>
        ${count ? `<span class="week-tab-count">${count}</span>` : ''}
        ${active && multi ? `<span class="week-tab-x" data-remove-week="${w.id}" role="button" aria-label="Delete ${escHtml(w.label)}">×</span>` : ''}
      </button>`
  }).join('') + `
    <button class="week-add" id="dupWeekBtn" title="Duplicate current week">⧉ Duplicate</button>
    <button class="week-add" id="addWeekBtn" title="Add a blank week">+ Week</button>`
}

// ── Roster (left party rail) ─────────────────────────────────
export function renderRoster() {
  const list = document.getElementById('rosterList')
  if (!list) return
  const { meetings, weeks, settings } = state
  const multi = weeks.length > 1

  if (!state.people.length) {
    list.innerHTML = `<p class="roster-empty">Add your team below, then drag them onto meetings.</p>`
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
      <div class="chip ${picked ? 'chip--picked' : ''}" data-person="${p.id}"
           draggable="false" tabindex="0" role="button"
           aria-label="${escHtml(p.name)}, ${multi ? `averaging ${avg.toFixed(1)} hours a week` : `${avg.toFixed(1)} hours`}, ${wkHours.toFixed(1)} this week in ${wkCount} meetings. ${picked ? 'Picked up. Press Enter on a meeting to seat.' : 'Press Enter to pick up.'}"
           title="${escHtml(p.name)}: ${avgLabel}/wk${multi ? ` · this week ${fmtHours(wkHours)}` : ''} across ${wkCount} meeting${wkCount === 1 ? '' : 's'}">
        <span class="chip-ring" style="--ring-deg:${deg}deg; --ring-color:${ringColor}; --class-color:${p.color}">
          <span class="chip-avatar" style="--class-color:${p.color}">${escHtml(initials(p.name))}</span>
        </span>
        <span class="chip-meta">
          <span class="chip-name">${escHtml(p.name)}</span>
          <span class="chip-load chip-load--${band}">${avgLabel} · ${wkCount} mtg${wkCount === 1 ? '' : 's'}</span>
        </span>
        ${band === 'red' ? '<span class="chip-pip" aria-hidden="true">!</span>' : ''}
        <button class="chip-remove" data-remove-person="${p.id}" aria-label="Remove ${escHtml(p.name)}" title="Remove">×</button>
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
          ${dayMeetings.map(renderBlock).join('') || `<div class="day-empty">Drop a meeting here</div>`}
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
    return `<span class="seat" style="--class-color:${p.color}" title="${escHtml(p.name)}" data-seat="${m.id}:${p.id}">${escHtml(initials(p.name))}<button class="seat-x" data-unseat="${m.id}:${p.id}" aria-label="Remove ${escHtml(p.name)}">×</button></span>`
  }).join('')
  const oversized = m.attendees.length > t.cap
  return `
    <article class="block ${oversized ? 'block--oversized' : ''}" data-meeting="${m.id}" data-type="${m.type}"
             tabindex="0" role="group"
             style="--type-color:${t.color}" aria-label="${escHtml(m.title || t.label)} meeting, ${m.attendees.length} attending. When a teammate is picked up, press Enter to seat them here.">
      <span class="block-notch" aria-hidden="true"></span>
      <div class="block-head">
        <span class="block-glyph" aria-hidden="true">${t.glyph}</span>
        <span class="block-title" data-edit-title="${m.id}" title="Click to rename">${escHtml(m.title || t.label)}</span>
        <button class="block-x" data-remove-meeting="${m.id}" aria-label="Delete meeting">×</button>
      </div>
      <div class="block-meta">
        <button class="chiplet" data-cycle-dur="${m.id}" title="Click to change duration">${m.durationMin}m</button>
        <button class="chiplet" data-cycle-rec="${m.id}" title="Click to change cadence">${rec.short}</button>
        <span class="chiplet chiplet--ghost" title="Weekly cost per attendee">${fmtHours(perHead)}/head</span>
      </div>
      <div class="block-seats" data-seats="${m.id}">
        ${seats || '<span class="seats-empty">drag people here</span>'}
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
    : `<li class="insight insight--ok"><div><div class="insight-title">All balanced</div><div class="insight-detail">No overloads, duplicates, or oversized meetings across your planned weeks.</div></div></li>`

  list.innerHTML = `
    <div class="bottle-wall" aria-label="Team workload bottles">
      ${bottles || '<p class="roster-empty">Add people to see their workload.</p>'}
    </div>
    ${state.people.length ? `<p class="wall-caption">${wallLabel} vs ${state.settings.thresholdHours}h threshold</p>` : ''}
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
    <div class="bottle ${over ? 'bottle--over' : ''}" title="${escHtml(p.name)}, ${multi ? 'avg ' : ''}${fmtHours(avg)} of ${state.settings.thresholdHours}h">
      <div class="bottle-glass">
        <div class="bottle-liquid bottle-liquid--${band}" style="height:${Math.min(pct, 100)}%"></div>
        <div class="bottle-threshold" aria-hidden="true"></div>
        ${over ? '<div class="bottle-splash" aria-hidden="true"></div>' : ''}
      </div>
      <span class="bottle-name">${escHtml(initials(p.name))}</span>
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
