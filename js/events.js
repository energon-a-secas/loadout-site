// ════════════════════════════════════════════════════════════
//  events.js — All user interaction: drag-and-drop, keyboard,
//  meeting CRUD, preset/slider, drawer. Delegated where sensible.
// ════════════════════════════════════════════════════════════

import {
  state, ui, addPerson, removePerson, addMeeting, removeMeeting,
  getMeeting, seatPerson, unseatPerson, getPerson,
  addWeek, removeWeek, renameWeek, setCurrentWeek,
  applyPreset, setThreshold, resetAll, snapshot, undo, debouncedSave,
} from './state.js'
import { TYPE_ORDER, MEETING_TYPES, RECURRENCE } from './data.js'
import { render, renderRoster, renderInsights, renderSettings } from './render.js'
import { $, showToast, initials, escHtml } from './utils.js'
import { personHoursInWeek, fillFor } from './load.js'

// Common re-render + persist after a mutation.
function commit() {
  render()
  debouncedSave()
}

const DURATIONS = [15, 30, 45, 60, 90, 120]
const REC_KEYS = Object.keys(RECURRENCE)

// ── Pointer drag (chip → block) ──────────────────────────────
// One shared interaction object, classified on pointerdown.
const drag = { active: false, personId: null, ghost: null, startX: 0, startY: 0, moved: false, pointerId: null }

function onPointerDown(e) {
  const chip = e.target.closest('.chip')
  if (!chip || e.target.closest('.chip-remove')) return
  // Left button / touch only.
  if (e.button !== undefined && e.button !== 0) return
  drag.active = true
  drag.moved = false
  drag.personId = chip.dataset.person
  drag.startX = e.clientX
  drag.startY = e.clientY
  drag.pointerId = e.pointerId
  chip.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e) {
  if (!drag.active) return
  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY
  if (!drag.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return

  if (!drag.moved) {
    drag.moved = true
    document.body.classList.add('dragging-person')
    const p = getPerson(drag.personId)
    const ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    ghost.style.setProperty('--class-color', p?.color || '#fff')
    ghost.textContent = initials(p?.name)
    document.body.appendChild(ghost)
    drag.ghost = ghost
  }
  drag.ghost.style.left = e.clientX + 'px'
  drag.ghost.style.top = e.clientY + 'px'

  // Highlight the block under the cursor.
  const block = elementBlockAt(e.clientX, e.clientY)
  document.querySelectorAll('.block.drop-target').forEach(b => b.classList.remove('drop-target'))
  if (block) block.classList.add('drop-target')
}

function onPointerUp(e) {
  if (!drag.active) return
  const wasMoved = drag.moved
  const personId = drag.personId
  cleanupDrag()
  if (!wasMoved) return // it was a tap → handled by click (pick up)

  const block = elementBlockAt(e.clientX, e.clientY)
  if (block) seatOnto(block.dataset.meeting, personId)
}

function elementBlockAt(x, y) {
  const el = document.elementFromPoint(x, y)
  return el ? el.closest('.block') : null
}

function cleanupDrag() {
  drag.ghost?.remove()
  drag.active = false
  drag.moved = false
  drag.personId = null
  document.body.classList.remove('dragging-person')
  document.querySelectorAll('.block.drop-target').forEach(b => b.classList.remove('drop-target'))
}

// Seat a person, with the "overflow" and "party assembled" signature moments.
function seatOnto(meetingId, personId) {
  const m = getMeeting(meetingId)
  const p = getPerson(personId)
  if (!m || !p) return
  // Overflow is judged on the meeting's own week (the week you're editing).
  const wk = m.weekId
  const overIn = () => fillFor(personHoursInWeek(personId, state.meetings, wk), state.settings.thresholdHours) > 1
  const wasOver = overIn()
  snapshot()
  const seated = seatPerson(meetingId, personId)
  if (!seated) { showToast(`${p.name} is already in that meeting`, 'info'); return }
  commit()

  const nowOver = overIn()
  if (!wasOver && nowOver) {
    showToast(`${p.name} is overloaded`, 'error')
    flashBottle(personId)
  } else {
    pulseSeat(meetingId, personId)
  }
}

function flashBottle(personId) {
  // find bottle by initials-name proximity is fragile; re-render already added
  // the bottle--over class. Trigger a quick attention pulse on the drawer badge.
  const badge = document.getElementById('insightBadge')
  badge?.classList.add('badge-pulse')
  setTimeout(() => badge?.classList.remove('badge-pulse'), 800)
}

function pulseSeat(meetingId, personId) {
  const seat = document.querySelector(`[data-seat="${meetingId}:${personId}"]`)
  seat?.classList.add('seat--land')
  setTimeout(() => seat?.classList.remove('seat--land'), 500)
}

// ── Click delegation ─────────────────────────────────────────
function onClick(e) {
  const t = e.target

  // ── Week tabs ──
  // Delete current week (the × on the active tab) — checked before switch/rename.
  const rmWeek = t.closest('[data-remove-week]')
  if (rmWeek) {
    e.stopPropagation()
    const w = state.weeks.find(w => w.id === rmWeek.dataset.removeWeek)
    if (w && confirm(`Delete ${w.label} and its meetings?`)) {
      snapshot(); removeWeek(rmWeek.dataset.removeWeek); commit()
    }
    return
  }
  // Double-click behavior for rename is handled below; a single click on the
  // label of the ALREADY-active week starts a rename.
  const renameTarget = t.closest('[data-rename-week]')
  if (renameTarget && renameTarget.dataset.renameWeek === state.currentWeekId) {
    editWeekName(renameTarget.dataset.renameWeek, renameTarget); return
  }
  // Switch weeks
  const weekTab = t.closest('[data-week]')
  if (weekTab) { snapshot(); setCurrentWeek(weekTab.dataset.week); commit(); return }

  // Remove person
  const rmPerson = t.closest('[data-remove-person]')
  if (rmPerson) {
    snapshot(); removePerson(rmPerson.dataset.removePerson); commit(); return
  }

  // Pick up / drop person via click (keyboard-free mouse path too)
  const chip = t.closest('.chip')
  if (chip && !t.closest('.chip-remove')) {
    togglePick(chip.dataset.person); return
  }

  // Seat a picked person by clicking a block
  const block = t.closest('.block')
  if (block && ui.pickedPersonId && !t.closest('.block-x') && !t.closest('.seat-x') && !t.closest('.chiplet') && !t.closest('[data-edit-title]')) {
    seatOnto(block.dataset.meeting, ui.pickedPersonId)
    setPicked(null)
    return
  }

  // Unseat
  const unseat = t.closest('[data-unseat]')
  if (unseat) {
    const [mid, pid] = unseat.dataset.unseat.split(':')
    snapshot(); unseatPerson(mid, pid); commit(); return
  }

  // Remove meeting
  const rmMeeting = t.closest('[data-remove-meeting]')
  if (rmMeeting) {
    snapshot(); removeMeeting(rmMeeting.dataset.removeMeeting); commit(); return
  }

  // Add meeting → open type picker
  const addBtn = t.closest('[data-add-meeting]')
  if (addBtn) { openTypePicker(addBtn.dataset.addMeeting, addBtn); return }

  // Cycle duration / recurrence
  const cd = t.closest('[data-cycle-dur]')
  if (cd) { cycleDuration(cd.dataset.cycleDur); return }
  const cr = t.closest('[data-cycle-rec]')
  if (cr) { cycleRecurrence(cr.dataset.cycleRec); return }

  // Edit title inline
  const et = t.closest('[data-edit-title]')
  if (et) { editTitle(et.dataset.editTitle, et); return }

  // Add / duplicate week (buttons live in the re-rendered tab bar)
  if (t.closest('#addWeekBtn')) { snapshot(); addWeek(); commit(); return }
  if (t.closest('#dupWeekBtn')) {
    snapshot(); addWeek(state.currentWeekId); commit()
    showToast('Week duplicated', 'info', 1400); return
  }
}

// Inline-rename a week from its tab label.
function editWeekName(weekId, el) {
  const w = state.weeks.find(w => w.id === weekId); if (!w) return
  const input = document.createElement('input')
  input.className = 'week-name-input'
  input.value = w.label
  input.maxLength = 24
  el.replaceWith(input)
  input.focus(); input.select()
  const done = () => { snapshot(); renameWeek(weekId, input.value); commit() }
  input.addEventListener('blur', done, { once: true })
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur() }
    if (ev.key === 'Escape') { input.value = w.label; input.blur() }
    ev.stopPropagation()
  })
  input.addEventListener('click', ev => ev.stopPropagation())
}

function togglePick(personId) {
  setPicked(ui.pickedPersonId === personId ? null : personId)
}
function setPicked(personId) {
  ui.pickedPersonId = personId
  renderRoster()
  document.body.classList.toggle('picking', !!personId)
  if (personId) {
    const p = getPerson(personId)
    showToast(`${p?.name} picked up. Click or Enter a meeting to seat them.`, 'info', 1800)
  }
}

function cycleDuration(meetingId) {
  const m = getMeeting(meetingId); if (!m) return
  const i = DURATIONS.indexOf(m.durationMin)
  m.durationMin = DURATIONS[(i + 1) % DURATIONS.length]
  commit()
}
function cycleRecurrence(meetingId) {
  const m = getMeeting(meetingId); if (!m) return
  const i = REC_KEYS.indexOf(m.recurrence)
  m.recurrence = REC_KEYS[(i + 1) % REC_KEYS.length]
  commit()
}

function editTitle(meetingId, el) {
  const m = getMeeting(meetingId); if (!m) return
  const input = document.createElement('input')
  input.className = 'block-title-input'
  input.value = m.title || ''
  input.placeholder = MEETING_TYPES[m.type]?.label || 'Meeting'
  input.maxLength = 40
  el.replaceWith(input)
  input.focus(); input.select()
  const done = () => { m.title = input.value.trim(); commit() }
  input.addEventListener('blur', done, { once: true })
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur() }
    if (ev.key === 'Escape') { input.value = m.title || ''; input.blur() }
  })
}

// ── Meeting type picker popover ──────────────────────────────
let picker = null
function openTypePicker(dayId, anchor) {
  closeTypePicker()
  picker = document.createElement('div')
  picker.className = 'type-picker'
  picker.innerHTML = TYPE_ORDER.map(key => {
    const t = MEETING_TYPES[key]
    return `<button class="type-opt" data-pick-type="${key}" style="--type-color:${t.color}">
      <span class="type-opt-glyph">${t.glyph}</span>${escHtml(t.label)}
      <span class="type-opt-dur">${t.defaultMin}m · ${RECURRENCE[t.defaultRecurrence].short}</span>
    </button>`
  }).join('')
  document.body.appendChild(picker)
  const r = anchor.getBoundingClientRect()
  picker.style.left = Math.min(r.left, window.innerWidth - 240) + 'px'
  picker.style.top = (r.bottom + 6) + 'px'

  picker.addEventListener('click', ev => {
    const opt = ev.target.closest('[data-pick-type]')
    if (!opt) return
    snapshot()
    addMeeting(dayId, opt.dataset.pickType)
    closeTypePicker()
    commit()
  })
  // Close on outside click / escape (deferred so this click doesn't self-close).
  setTimeout(() => document.addEventListener('pointerdown', outsidePicker, true), 0)
}
function outsidePicker(e) {
  if (picker && !picker.contains(e.target)) closeTypePicker()
}
function closeTypePicker() {
  picker?.remove(); picker = null
  document.removeEventListener('pointerdown', outsidePicker, true)
}

// ── Keyboard ─────────────────────────────────────────────────
function onKeydown(e) {
  // Enter/Space on a focused chip picks it up; on a block seats the picked person.
  const active = document.activeElement
  if ((e.key === 'Enter' || e.key === ' ') && active?.classList.contains('chip')) {
    e.preventDefault(); togglePick(active.dataset.person); return
  }
  if (e.key === 'Enter' && active?.classList.contains('block') && ui.pickedPersonId) {
    e.preventDefault(); seatOnto(active.dataset.meeting, ui.pickedPersonId); setPicked(null); return
  }
  if (e.key === 'Escape') {
    if (picker) { closeTypePicker(); return }
    if (ui.pickedPersonId) { setPicked(null); return }
  }
  // Undo
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (undo()) { render(); debouncedSave(); showToast('Undone', 'info', 1200) }
  }
}

// ── Toolbar / roster form / settings ─────────────────────────
function bindToolbar() {
  const nameInput = $.personName()
  const addPersonBtn = document.getElementById('addPersonBtn')
  const submitPerson = () => {
    const name = nameInput.value.trim()
    if (!name) { nameInput.focus(); return }
    snapshot(); addPerson(name); nameInput.value = ''; commit(); nameInput.focus()
  }
  addPersonBtn?.addEventListener('click', submitPerson)
  nameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitPerson() } })

  $.presetSelect()?.addEventListener('change', e => {
    snapshot(); applyPreset(e.target.value); commit()
  })
  $.thresholdRange()?.addEventListener('input', e => {
    setThreshold(Number(e.target.value))
    renderSettings(); renderRoster(); renderInsights(); debouncedSave()
  })

  document.getElementById('insightToggle')?.addEventListener('click', () => {
    ui.drawerOpen = !ui.drawerOpen
    document.body.classList.toggle('drawer-open', ui.drawerOpen)
  })
  const closeDrawer = () => { ui.drawerOpen = false; document.body.classList.remove('drawer-open') }
  document.getElementById('drawerClose')?.addEventListener('click', closeDrawer)
  document.getElementById('drawerScrim')?.addEventListener('click', closeDrawer)

  document.getElementById('resetBtn')?.addEventListener('click', () => {
    if (!state.people.length && !state.meetings.length) return
    if (confirm('Clear the whole board and roster?')) {
      snapshot(); resetAll(); commit(); showToast('Board cleared', 'info')
    }
  })

  document.getElementById('sampleBtn')?.addEventListener('click', loadSample)
}

// A one-click demo team across three distinct weeks so the multi-week
// planner (and how load averages vs. spikes) is obvious at a glance.
function loadSample() {
  snapshot()
  resetAll()
  const names = ['Maya Chen', 'Diego Ruiz', 'Priya Nair', 'Tom Weber']
  const people = names.map(n => addPerson(n))
  const ids = people.map(p => p.id)

  // Week 1 — a steady baseline cadence.
  renameWeek(state.currentWeekId, 'Steady week')
  const daily = addMeeting('mon', 'daily'); daily.attendees = ids
  const wed = addMeeting('wed', 'weekly'); wed.attendees = ids.slice(0, 3)
  const oneone = addMeeting('fri', 'oneonone'); oneone.attendees = [ids[0]]

  // Week 2 — clone the baseline, then pile on a customer push (spike).
  const heavy = addWeek(state.currentWeekId)
  renameWeek(heavy.id, 'Launch week')
  const c1 = addMeeting('tue', 'customer'); c1.attendees = [ids[0], ids[1]]
  const c2 = addMeeting('thu', 'customer'); c2.attendees = [ids[0], ids[1]]
  const push = addMeeting('wed', 'daily'); push.attendees = [ids[0], ids[1]]

  // Week 3 — a lighter recovery week.
  const light = addWeek()
  renameWeek(light.id, 'Recovery week')
  const standup = addMeeting('mon', 'daily'); standup.attendees = ids

  setCurrentWeek(state.weeks[0].id)
  commit()
  showToast('Sample: 4 people across 3 weeks', 'info')
}

// ── Wire everything ──────────────────────────────────────────
export function bindEvents() {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', cleanupDrag)
  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKeydown)
  bindToolbar()
}
