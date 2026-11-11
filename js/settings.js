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
import { state, addPerson, getPerson, snapshot, saveState, debouncedSave } from './state.js'
import { render, renderInsights } from './render.js'
import { planAdd, toWorkspace, workspaceId, weeklyHours } from './team-adapter.js'
import { showToast } from './utils.js'

let ws = null
let weekNote = null

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function applyPrefs() {
  state.settings.workHours = weeklyHours(ws.prefs(), state.settings.workHours || 40)
}

function weekText() {
  const p = ws.prefs()
  const hours = weeklyHours(p, 40)
  const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const span = Array.isArray(p.h) ? `${fmt(p.h[0])} to ${fmt(p.h[1])}` : 'your hours'
  const days = typeof p.d === 'string' ? p.d.length : 5
  return `Your work week is ${hours}h (${span}, ${plural(days, 'day', 'days')}), from the settings above. The Signals drawer measures each person's meetings against it.`
}

export function addTeam(workspace) {
  const plan = planAdd(workspace, state.people)
  if (!plan.add.length && !plan.link.length) {
    showToast(plan.kept ? 'Your team is already on the board' : 'Your workspace has nobody to add yet', 'info')
    return plan
  }
  snapshot()
  for (const l of plan.link) { const p = getPerson(l.id); if (p) p.ws = l.ws }
  for (const a of plan.add) addPerson(a.name, { color: a.color, ws: a.ws })
  render()
  debouncedSave()
  const from = plan.teams.length ? ` from ${plan.teams.join(', ')}` : ''
  showToast(`Added ${plural(plan.add.length, 'person', 'people')}${from}`, 'info')
  return plan
}

function payload() {
  // Tie each chip to the id it is saved under, so "Add my team" later finds it.
  for (const p of state.people) if (!p.ws) p.ws = workspaceId(p)
  saveState()
  return toWorkspace(state.people)
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
  if (banner) ws.banner(banner)
  return ws
}

export const workspace = () => ws
