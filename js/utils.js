// ════════════════════════════════════════════════════════════
//  utils.js — Small shared helpers (adapted from pathfinder-site)
// ════════════════════════════════════════════════════════════

// ── ID generator ─────────────────────────────────────────────
// Monotonic within a session, collision-safe. Better than Math.random.
let _sid = 0
export function genId() { return (Date.now().toString(36) + (++_sid).toString(36)) }

// ── Pure helpers ─────────────────────────────────────────────
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function debounce(fn, ms) {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

// Two-letter initials from a name for the character chip.
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Render a decimal hour count as a compact human string: 2.75 → "2h 45m".
export function fmtHours(h) {
  const total = Math.round(h * 60)
  const hrs = Math.floor(total / 60)
  const mins = total % 60
  if (hrs && mins) return `${hrs}h ${mins}m`
  if (hrs) return `${hrs}h`
  return `${mins}m`
}

// ── DOM element cache ────────────────────────────────────────
export const $ = {
  rosterList:    () => document.getElementById('rosterList'),
  personName:    () => document.getElementById('personName'),
  board:         () => document.getElementById('board'),
  insightDrawer: () => document.getElementById('insightDrawer'),
  insightList:   () => document.getElementById('insightList'),
  insightBadge:  () => document.getElementById('insightBadge'),
  insightToggle: () => document.getElementById('insightToggle'),
  presetSelect:  () => document.getElementById('presetSelect'),
  thresholdRange:() => document.getElementById('thresholdRange'),
  thresholdVal:  () => document.getElementById('thresholdVal'),
  dragGhost:     () => document.getElementById('dragGhost'),
}

// ── Toast notification + screen-reader announcement ──────────
let toastTimeout
export function showToast(message, type = 'info', duration = 2600) {
  const existing = document.querySelector('.toast-notification')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.className = `toast-notification toast-${type}`
  // Announced by screen readers. Without these the toast is
  // invisible to anyone not looking at that corner of the screen.
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message
  document.body.appendChild(toast)
  void toast.offsetWidth // force reflow so the entrance transition runs
  toast.classList.add('visible')

  const live = document.getElementById('toastLive')
  if (live) live.textContent = message

  if (toastTimeout) clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible')
    setTimeout(() => toast.remove(), 300)
  }, duration)
}
