// ── Entry point ──────────────────────────────────────────────
// Imports modules and initializes the app. Wiring only.

import { loadState, bindSaveFlush } from './state.js'
import { render } from './render.js'
import { bindEvents } from './events.js'
import { initWorkspace } from './settings.js'

function init() {
  loadState()
  bindSaveFlush()
  // The board never depends on the Workspace: a kit failure leaves Loadout working.
  try { initWorkspace() } catch (err) { console.error('[loadout] workspace', err) }
  render()
  bindEvents()
}

init()
