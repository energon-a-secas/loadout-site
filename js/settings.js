// ════════════════════════════════════════════════════════════
//  settings.js: the Neorgon Workspace in Loadout.
//
//  The header gear and the , key open the fleet's Settings sheet. "Add my
//  team to Loadout" puts the workspace team on the roster (js/team-adapter.js
//  decides who and how), "Save this board's people" sends the roster back
//  through the Workspace page's review, and the work week behind the
//  overload signal comes from the visitor's working hours and work days.
//  Kit: js/neorgon-workspace*.js, vendored, never edited here.
// ════════════════════════════════════════════════════════════

import { NeoWorkspace } from './neorgon-workspace.js'
import { state, addPerson, getPerson, snapshot, debouncedSave } from './state.js'
import { render, renderInsights } from './render.js'
import { planAdd, toWorkspace, weeklyHours, confirmAddText, fmtClock } from './team-adapter.js'
import { showToast } from './utils.js'
import { cleanColor } from './validate.js'

let ws = null
let weekNote = null

/** This device's hour cycle, for the "This device's" time format. */
function deviceCycle() {
  try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle || 'h23' } catch { return 'h23' }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function applyPrefs() {
  state.settings.workHours = weeklyHours(ws.prefs(), state.settings.workHours || 40)
}

function weekText() {
  const p = ws.prefs()
  const hours = weeklyHours(p, 40)
  const fmt = m => fmtClock(m, p.c, deviceCycle())
  const span = Array.isArray(p.h) ? `${fmt(p.h[0])} to ${fmt(p.h[1])}` : 'your hours'
  const days = typeof p.d === 'string' ? p.d.length : 5
  return `Your work week is ${hours}h (${span}, ${plural(days, 'day', 'days')}), from the settings above. The Signals drawer measures each person's meetings against it.`
}

export function addTeam(workspace, ask = (q) => window.confirm(q)) {
  const plan = planAdd(workspace, state.people)
  if (!plan.add.length && !plan.link.length) {
    showToast(plan.kept ? 'Your team is already on the board' : 'Your workspace has nobody to add yet', 'info')
    return plan
  }
  const question = confirmAddText(plan)
  if (question && !ask(question)) {
    // The kit closes its banner (or the sheet) whatever this returns, so say
    // where the offer lives now: the Settings sheet keeps the button.
    showToast('Nobody added. Add your team any time from Settings (press ,)', 'info')
    return { ...plan, add: [], link: [], declined: true }
  }
  snapshot()
  for (const l of plan.link) { const p = getPerson(l.id); if (p) { p.ws = l.ws; p.color = cleanColor(l.color) || p.color } }
  for (const a of plan.add) addPerson(a.name, { color: a.color, ws: a.ws })
  render()
  debouncedSave()
  const from = plan.teams.length ? ` from ${plan.teams.join(', ')}` : ''
  showToast(plan.add.length
    ? `Added ${plural(plan.add.length, 'person', 'people')}${from}`
    : `Your team is already on the board. ${plural(plan.link.length, 'person', 'people')} now linked to your workspace`, 'info')
  return plan
}

function payload() {
  // Nothing is written to the chips here. The review may merge a chip into a
  // person under another id, or the visitor may press "Not now"; planAdd finds
  // the chip again by the id it was saved under, or by its name.
  return toWorkspace(state.people)
}

/**
 * The banner offers the team only while "Add my team" would add someone.
 * The kit draws and hides it on its own terms; this hides it too once
 * everybody it would bring is already on the board.
 */
function syncBanner(el) {
  const t = ws.team()
  const done = t.status !== 'stale' && !!t.ws && planAdd(t.ws, state.people).add.length === 0
  el.classList.toggle('ws-banner--done', done)
}

export function initWorkspace() {
  ws = NeoWorkspace.init({
    tool: 'loadout',
    name: 'Loadout',
    actions: {
      use: { label: 'Add my team to Loadout', run: addTeam },
      save: { label: "Save this board's people to your workspace", payload },
    },
    section: {
      title: 'Loadout',
      render(el) {
        weekNote = document.createElement('p')
        weekNote.className = 'neo-ws-note'
        weekNote.textContent = weekText()
        el.append(weekNote)
      },
    },
  })
  applyPrefs()
  ws.on('prefs', () => {
    applyPrefs()
    if (weekNote && weekNote.isConnected) weekNote.textContent = weekText()
    renderInsights()
    debouncedSave()
  })
  ws.mountGear({ keepMobile: true })
  const banner = document.getElementById('wsBanner')
  if (banner) {
    ws.banner(banner)
    const sync = () => syncBanner(banner)
    ws.on('team', sync)
    const list = document.getElementById('rosterList')
    if (list) new MutationObserver(sync).observe(list, { childList: true })
    sync()
  }
  return ws
}

export const workspace = () => ws
