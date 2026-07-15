// ── Entry point ──────────────────────────────────────────────
// Imports modules and initializes the app. Wiring only.

import { loadState } from './state.js'
import { render } from './render.js'
import { bindEvents } from './events.js'

function init() {
  loadState()
  render()
  bindEvents()
}

init()
