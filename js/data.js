// ════════════════════════════════════════════════════════════
//  data.js — Static domain constants
//  Meeting types, presets, recurrence weighting, week days.
// ════════════════════════════════════════════════════════════

// Week days rendered as board columns (no hours — meeting blocks only).
export const DAYS = [
  { id: 'mon', label: 'Mon' },
  { id: 'tue', label: 'Tue' },
  { id: 'wed', label: 'Wed' },
  { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' },
]

// How many times a placed block actually happens per week. This is the
// single most important correctness lever: a "Daily" block on Monday costs
// its duration five times a week, a one-off follow-up costs a quarter (it
// amortizes across a month). Load = duration × weeklyFactor × attendance.
export const RECURRENCE = {
  daily:    { label: 'Every day',   factor: 5,    short: '5×/wk' },
  weekly:   { label: 'Weekly',      factor: 1,    short: '1×/wk' },
  biweekly: { label: 'Biweekly',    factor: 0.5,  short: '½×/wk' },
  monthly:  { label: 'Monthly',     factor: 0.25, short: '¼×/wk' },
  once:     { label: 'One-off',     factor: 0.25, short: 'once' },
}

// Meeting types drive color, default duration, default cadence, an icon
// glyph, and a "sane attendee cap" the insight engine uses to flag bloat
// (a 1:1 with 8 people is pointless).
export const MEETING_TYPES = {
  daily: {
    label: 'Daily', color: '#38bdf8', glyph: '◔',
    defaultMin: 15, defaultRecurrence: 'daily', cap: 12,
  },
  weekly: {
    label: 'Weekly', color: '#a78bfa', glyph: '◎',
    defaultMin: 30, defaultRecurrence: 'weekly', cap: 15,
  },
  monthly: {
    label: 'Monthly', color: '#c084fc', glyph: '◉',
    defaultMin: 30, defaultRecurrence: 'monthly', cap: 30,
  },
  oneonone: {
    label: '1:1', color: '#34d399', glyph: '○',
    defaultMin: 30, defaultRecurrence: 'weekly', cap: 2,
  },
  customer: {
    label: 'Customer sync', color: '#fb923c', glyph: '◈',
    defaultMin: 60, defaultRecurrence: 'weekly', cap: 8,
  },
  followup: {
    label: 'Follow-up', color: '#fbbf24', glyph: '▸',
    defaultMin: 30, defaultRecurrence: 'once', cap: 6,
  },
  custom: {
    label: 'Custom', color: '#94a3b8', glyph: '◆',
    defaultMin: 30, defaultRecurrence: 'weekly', cap: 12,
  },
}

// The order meeting types appear in the palette / add-meeting picker.
export const TYPE_ORDER = ['daily', 'weekly', 'monthly', 'oneonone', 'customer', 'followup', 'custom']

// Team presets set a STARTING overload threshold (weekly meeting-hours) and a
// baseline work week. The user can drag the threshold slider afterward, which
// flips the preset to "custom" but keeps the number.
export const PRESETS = {
  new:         { label: 'New team',       thresholdHours: 8,  workHours: 40, note: 'More syncs while the team ramps up' },
  experienced: { label: 'Experienced',    thresholdHours: 5,  workHours: 40, note: 'Lean cadence, protect focus time' },
  support:     { label: 'Support team',   thresholdHours: 10, workHours: 40, note: 'Higher meeting tolerance by nature' },
  custom:      { label: 'Custom',         thresholdHours: 6,  workHours: 40, note: 'Threshold tuned by hand' },
}

// RPG "class color" ring palette for character chips. Cycled as people are added.
export const CLASS_COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#34d399',
  '#38bdf8', '#818cf8', '#a78bfa', '#f472b6',
  '#2dd4bf', '#c084fc', '#fca5a5', '#60a5fa',
]

// Load bands as a fraction of threshold. <0.7 green, 0.7–1 amber, >1 red.
export const BANDS = {
  green: { max: 0.7,      color: '#34d399', label: 'Balanced' },
  amber: { max: 1.0,      color: '#fbbf24', label: 'Filling up' },
  red:   { max: Infinity, color: '#f43f5e', label: 'Overloaded' },
}
