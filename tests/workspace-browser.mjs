/**
 * Browser check for Loadout's Workspace adoption, in Chromium, Firefox and
 * WebKit. Not a node --test file: it needs Playwright's browsers (from the
 * monorepo root) and starts two local servers itself:
 *   Loadout on LO_TOOL_PORT (9370), neorgon-site (the frame and the Workspace page) on LO_FRAME_PORT (9371).
 *
 *   node tests/workspace-browser.mjs [chromium,firefox,webkit]
 *
 * Playwright turns Chromium's storage partitioning off and sets Firefox's
 * cookieBehavior to 4; both go back to the browsers' defaults here, or the
 * sharing check passes for the wrong reason.
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = fileURLToPath(new URL('../', import.meta.url))
const ROOT = join(SITE, '../../')
const require = createRequire(join(ROOT, 'package.json'))
const { chromium, firefox, webkit } = require('playwright')
const W = await import('../js/neorgon-workspace-core.js')

const TOOL_PORT = Number(process.env.LO_TOOL_PORT || 9370)
const FRAME_PORT = Number(process.env.LO_FRAME_PORT || 9371)
const TOOL = `http://localhost:${TOOL_PORT}`
const FRAME = `http://localhost:${FRAME_PORT}`
const servers = [[TOOL_PORT, SITE], [FRAME_PORT, join(ROOT, 'projects/neorgon-site')]]
  .map(([port, dir]) => spawn('python3', [join(ROOT, 'scripts/serve.py'), String(port), dir], { stdio: 'ignore' }))
const stop = () => servers.forEach((s) => s.kill())
process.on('exit', stop)
// Wait until both servers answer, then retry any load that still meets a refused connection.
for (const port of [TOOL_PORT, FRAME_PORT]) {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://localhost:${port}/`); break } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
}
const REFUSED = /CONNECTION_REFUSED|ECONNREFUSED|Could not connect|NS_ERROR_CONNECTION|ERR_CONNECTION/i
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (err) {
      if (i >= 4 || !REFUSED.test(String(err && err.message))) throw err
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
}
const reload = (page) => retry(() => page.reload())

const engines = (process.argv[2] || 'chromium,firefox,webkit').split(',')
const results = []
const check = (eng, name, ok, extra = '') => { results.push({ eng, name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${eng}: ${name}${extra && !ok ? ' ' + extra : ''}`) }
const LOCAL = { protocol: 'http:', hostname: 'localhost' }
const XSS = '"><img src=x onerror=alert(1)>'

const WS = {
  v: 1,
  me: { person: 'ana-rojas' },
  people: [
    { id: 'ana-rojas', name: 'Ana Rojas' },
    { id: 'kenji-sato', name: 'Kenji Sato', color: '#0f766e' },
    // Longer than the 40 characters Loadout once kept: a save straight back must not shorten it.
    { id: 'lea-muller', name: 'Léa Müller de los Angeles Fernandez-Gutierrez Castillo' },
    { id: 'evil', name: XSS, color: 'red;background:url(//x)' },
    // The sample team has a Priya Nair of its own: saving it must not repaint her.
    { id: 'priya-nair', name: 'Priya Nair', color: '#123456' },
  ],
  teams: [
    { id: 'payments', name: 'Payments', lead: 'ana-rojas', members: [{ person: 'kenji-sato' }, { person: 'lea-muller' }, { person: 'evil' }] },
    { id: 'platform', name: 'Platform', members: [{ person: 'priya-nair' }] },
  ],
}
const MEMBERS = ['ana-rojas', 'kenji-sato', 'lea-muller', 'evil']

async function launch(eng) {
  if (eng === 'chromium') {
    const probe = await chromium.launch({ args: ['--enable-automation'] })
    const cdp = await probe.newBrowserCDPSession()
    const cmd = (await cdp.send('Browser.getBrowserCommandLine')).arguments.join(' ')
    await probe.close()
    const arg = (cmd.match(/--disable-features=\S+/) || [])[0]
    if (!arg) return chromium.launch()
    const kept = arg.replace(/(,)?ThirdPartyStoragePartitioning/, '').replace('=,', '=')
    return chromium.launch({ ignoreDefaultArgs: [arg], args: [kept] })
  }
  if (eng === 'firefox') return firefox.launch({ firefoxUserPrefs: { 'network.cookie.cookieBehavior': 5 } })
  return webkit.launch()
}

// A page whose own origin points the client at our frame server.
async function open(ctx, path = '/') {
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss() })
  await retry(() => page.goto(TOOL + path))
  await page.evaluate((o) => { localStorage.setItem('neo-ws:dev-origin', o) }, FRAME)
  return { page, errors }
}

async function seedFrame(ctx) {
  const p = await ctx.newPage()
  await retry(() => p.goto(FRAME + '/workspace/vault.html'))
  const stamp = W.makeStamp()
  const ws = W.normalizeWorkspace(WS).ws
  await p.evaluate(([rec, cookie]) => { localStorage.setItem('neo-ws:workspace', JSON.stringify(rec)); document.cookie = cookie },
    [{ __v: W.STORE_VERSION, data: { stamp, ws } }, W.stampCookie(stamp, LOCAL)])
  await p.close()
  return stamp
}

const chips = (page) => page.$$eval('.chip', (els) => els.map((e) => ({
  name: e.querySelector('.chip-name').textContent,
  initials: e.querySelector('.chip-avatar').textContent,
  color: getComputedStyle(e.querySelector('.chip-avatar')).getPropertyValue('--class-color').trim(),
})))

for (const eng of engines) {
  const browser = await launch(eng)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

  // 1. Hostile saved state renders as text.
  {
    const { page, errors } = await open(ctx)
    await page.evaluate((X) => localStorage.setItem('loadout-v1', JSON.stringify({
      people: [{ id: X, name: X, color: 'red;x:url(y)' }], weeks: [{ id: X, label: X }],
      meetings: [{ id: X, weekId: X, type: X, durationMin: X, attendees: [X] }], settings: { thresholdHours: X },
    })), XSS)
    await reload(page)
    await page.waitForSelector('.chip')
    check(eng, 'hostile saved state renders as text', (await page.locator('img[src=x]').count()) === 0 && (await page.locator('.block').count()) === 1 && !errors.length, errors.join('; '))
    await page.evaluate(() => localStorage.removeItem('loadout-v1'))
    await page.close()
  }

  // 2. The frame shares the team (Chromium, Firefox); Add my team brings the payments team with kit faces.
  await seedFrame(ctx)
  {
    const { page, errors } = await open(ctx)
    await reload(page)
    // Both servers are localhost, one site, so every engine shares here; WebKit partitions
    // only across sites. The Load path is checked when a frame does not share.
    const banner = page.locator('#wsBanner button.neo-ws-primary')
    await banner.waitFor({ timeout: 6000 }).catch(() => {})
    const shares = await banner.isVisible().catch(() => false)
    if (shares || eng !== 'webkit') {
      check(eng, 'the banner offers the shared team', shares)
      await banner.click().catch(() => {})
      await page.waitForTimeout(200)
      const got = await chips(page)
      const want = W.normalizeWorkspace(WS).ws.people.filter((p) => MEMBERS.includes(p.id))
      const same = got.length === want.length && want.every((p, i) => got[i].name === p.name && got[i].initials === W.initials(p.name) && got[i].color === W.colorFor(p))
      check(eng, 'Add my team: names, kit colours and initials', same, JSON.stringify(got))
      check(eng, 'a hostile workspace name is text, its colour refused', (await page.locator('img[src=x]').count()) === 0 && got.every((c) => /^#[0-9a-f]{6}$/.test(c.color)))
      // Again from the sheet: nobody twice.
      await page.keyboard.press(',')
      await page.locator('dialog[open] .neo-ws-primary').click()
      await page.waitForTimeout(200)
      check(eng, 'a second Add my team adds nobody', (await page.locator('.chip').count()) === want.length)
      // Saved with the workspace id, so a reload keeps the link.
      await page.waitForTimeout(400)
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('loadout-v1')).people.map((p) => p.ws))
      check(eng, 'chips keep their workspace ids across a reload', stored.join() === MEMBERS.join(), stored.join())
      // Everyone the banner would bring is on the board: after a reload it offers nothing.
      await reload(page)
      await page.waitForTimeout(600)
      check(eng, 'the banner is gone once the team is on the board', !(await page.locator('#wsBanner').isVisible()))
      // Saved straight back, the team changes nothing: every name whole, no colour sent.
      await page.keyboard.press(',')
      await page.locator('dialog[open] button', { hasText: "Save this board's people" }).click()
      await page.waitForURL(/\/workspace\/#save=/, { timeout: 5000 }).catch(() => {})
      const back = W.parseFragment(new URL(page.url()).hash, { selfHostname: 'localhost' })
      const sentBack = back && W.decodePayload(back.payload)
      const merged = sentBack && W.previewMerge(W.normalizeWorkspace(WS).ws, sentBack.ws)
      check(eng, 'the team saved straight back changes nothing', !!merged && !merged.added.length && !merged.updated.length && sentBack.ws.people.every((p) => !('color' in p)),
        JSON.stringify(merged && { added: merged.added, updated: merged.updated }))
    } else {
      // No shared team: the sheet offers the round trip.
      await page.keyboard.press(',')
      check(eng, 'no shared team: the sheet offers Load your team', await page.locator('dialog[open] button', { hasText: 'Load your team' }).isVisible())
      await page.keyboard.press('Escape')
    }
    check(eng, 'no page errors with the frame', !errors.length, errors.join('; '))
    await page.close()
  }

  // 3. The , key, Escape and focus; the work week from the settings.
  {
    const { page } = await open(ctx)
    await page.evaluate((c) => { document.cookie = c }, W.meCookie({ h: [540, 780], d: '135' }, LOCAL))
    await reload(page)
    await page.waitForSelector('.neo-ws-gear')
    await page.locator('#main').click({ position: { x: 600, y: 5 } }).catch(() => {})
    await page.keyboard.press(',')
    const dialog = page.locator('dialog[open]')
    check(eng, ', opens Settings', await dialog.isVisible())
    const note = await dialog.locator('.neo-ws-note', { hasText: 'work week' }).textContent().catch(() => '')
    check(eng, 'the work week comes from working hours times work days', /\b12h\b/.test(note), note)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    check(eng, 'Escape closes and focus returns to the gear', (await page.locator('dialog[open]').count()) === 0 && await page.evaluate(() => document.activeElement?.classList.contains('neo-ws-gear')))
    // The overload signal reads the 12h week.
    await page.evaluate(() => document.getElementById('sampleBtn').click())
    await page.waitForTimeout(200)
    const detail = await page.locator('#insightList .insight-detail').allTextContents()
    check(eng, 'signals measure against the 12h week', detail.some((t) => t.includes('of a 12h week')), detail.join(' | '))
    await page.evaluate((c) => { document.cookie = c }, W.clearCookie(W.COOKIE_ME, LOCAL))
    await page.close()
  }

  // 4. Keyboard: a duration chip keeps focus after it changes; the drawer is out of the tab order when closed.
  {
    const { page } = await open(ctx)
    await reload(page)
    await page.evaluate(() => document.getElementById('sampleBtn').click())
    const dur = page.locator('[data-cycle-dur]').first()
    const id = await dur.getAttribute('data-cycle-dur')
    await dur.focus()
    await page.keyboard.press('Enter')
    const still = await page.evaluate((i) => document.activeElement?.dataset.cycleDur === i, id)
    check(eng, 'a duration chip keeps focus after it changes', still)
    const closeVisible = await page.evaluate(() => getComputedStyle(document.getElementById('insightDrawer')).visibility)
    check(eng, 'the closed Signals drawer is hidden from the tab order', closeVisible === 'hidden')
    await page.locator('#insightToggle').click()
    await page.waitForTimeout(350)
    check(eng, 'opening Signals moves focus into it', await page.evaluate(() => document.activeElement?.id === 'drawerClose'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(350)
    check(eng, 'Escape closes Signals, focus back on its toggle', await page.evaluate(() => document.activeElement?.id === 'insightToggle'))
    await page.close()
  }

  // 5. Save: the sheet sends the board's people to the Workspace page's review.
  {
    const { page } = await open(ctx)
    await reload(page)
    await page.evaluate(() => document.getElementById('sampleBtn').click())
    await page.keyboard.press(',')
    await page.locator('dialog[open] button', { hasText: "Save this board's people" }).click()
    await page.waitForURL(/\/workspace\/#save=/, { timeout: 5000 }).catch(() => {})
    const got = W.parseFragment(new URL(page.url()).hash, { selfHostname: 'localhost' })
    const sent = got && W.decodePayload(got.payload)
    const names = sent ? sent.ws.people.map((p) => p.name) : []
    check(eng, 'save opens the review with the board\'s people', !!got && got.tool === 'loadout' && names.join() === 'Maya Chen,Diego Ruiz,Priya Nair,Tom Weber', page.url().slice(0, 120))
    const priya = sent && W.previewMerge(W.normalizeWorkspace(WS).ws, sent.ws).next.people.find((p) => p.id === 'priya-nair')
    check(eng, 'a sample chip merged by name keeps the workspace colour', !!priya && priya.color === '#123456', JSON.stringify(priya))
    // The review may merge a chip under another id, or be declined: the chips keep no made-up one.
    await retry(() => page.goto(TOOL + '/'))
    const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('loadout-v1') || '{"people":[]}').people.map((p) => p.ws || ''))
    check(eng, 'saving writes no workspace id onto the chips', ids.length === 4 && ids.every((w) => !w), ids.join())
    await page.close()
  }

  // 6. A pick's answer is taken once; a planted one is ignored.
  {
    const { page } = await open(ctx)
    const payload = await W.encodePayload({ v: 1, people: [{ id: 'zed', name: 'Zed Planted' }] })
    await page.goto('about:blank')   // a hash-only goto would not load the page again
    await page.goto(W.answerLink(TOOL + '/', { payload, stamp: W.makeStamp() }, { selfHostname: 'localhost' }))
    await page.waitForTimeout(300)
    const cached = await page.evaluate(() => localStorage.getItem('neo-ws:cache') || '')
    check(eng, 'an answer this tab did not ask for is ignored and stripped', !cached.includes('Zed Planted') && !page.url().includes('neo-ws='))
    await page.close()
  }

  // 7. Phone: chip removes show without hover at 44px; a face's remove waits for a tap.
  {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: eng !== 'firefox' })
    const { page } = await open(phone)
    await reload(page)
    await page.evaluate(() => document.getElementById('sampleBtn').click())
    const box = await page.locator('.chip-remove').first().boundingBox()
    const op = await page.locator('.chip-remove').first().evaluate((e) => getComputedStyle(e).opacity)
    check(eng, 'phone: chip remove visible and 44px', box && box.width >= 44 && box.height >= 44 && op === '1', JSON.stringify(box) + ' ' + op)
    // A face's remove badge waits for a tap on that face, then removes on a tap.
    if (await page.evaluate(() => matchMedia('(hover: none)').matches)) {
      const seat = page.locator('.seat').first()
      const x = seat.locator('.seat-x')
      const hiddenFirst = await x.evaluate((e) => getComputedStyle(e).visibility === 'hidden')
      const before = await page.locator('.seat').count()
      await seat.tap({ position: { x: 8, y: 22 } })
      const shown = await x.evaluate((e) => getComputedStyle(e).visibility === 'visible')
      const others = await page.locator('.seat--armed').count()
      check(eng, 'phone: a face shows its remove only once tapped', hiddenFirst && shown && others === 1)
      await x.tap()
      await page.waitForTimeout(100)
      check(eng, 'phone: the shown remove takes the face off the meeting', (await page.locator('.seat').count()) === before - 1)
    }
    // The roster shows the whole sample team above the add field.
    const fits = await page.evaluate(() => {
      const last = [...document.querySelectorAll('.chip')].pop().getBoundingClientRect()
      return last.bottom <= document.querySelector('.roster-add').getBoundingClientRect().top + 1
    })
    check(eng, 'phone: the sample roster is not cut by the add field', fits)
    const tiny = await page.$$eval('body *', (els) => els.filter((e) => e.childElementCount === 0 && e.textContent.trim() && e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.className + ':' + e.textContent.trim().slice(0, 20)))
    check(eng, 'phone: no visible text under 12px', !tiny.length, tiny.slice(0, 5).join(', '))
    await phone.close()
  }

  // 9. The #154 minors: a save flushed on reload, a large team asked about,
  //    a hidden remove that keeps the name whole, and hours in the visitor's format.
  {
    const page = await ctx.newPage()
    const errors = [], dialogs = []
    let answer = false
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('dialog', (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss() })
    await retry(() => page.goto(TOOL + '/'))
    await page.evaluate(() => localStorage.removeItem('loadout-v1'))
    await reload(page)
    // An edit within the 300ms debounce, then straight into a reload.
    await page.fill('#personName', 'Just Before Reload')
    await page.press('#personName', 'Enter')
    await reload(page)
    await page.waitForSelector('.chip', { timeout: 3000 }).catch(() => {})
    check(eng, 'an edit made just before a reload is kept', (await page.locator('.chip-name', { hasText: 'Just Before Reload' }).count()) === 1)
    // An edit within the debounce, then the tab closed at once. Firefox is left
    // out: Playwright's close there can end the content process before its
    // localStorage write reaches the parent, which a real closed tab does not do.
    if (eng !== 'firefox') {
      const other = await ctx.newPage()
      await retry(() => other.goto(TOOL + '/'))
      await other.fill('#personName', 'Just Before Close')
      await other.press('#personName', 'Enter')
      await other.close({ runBeforeUnload: true })
      await page.waitForTimeout(300)
      await reload(page)
      check(eng, 'an edit made just before a tab closes is kept', (await page.locator('.chip-name', { hasText: 'Just Before Close' }).count()) === 1)
    }

    // A hidden remove holds no width: the name runs to the chip's edge at 1440.
    await page.fill('#personName', 'Maximiliana Fernandez-Gutierrez')
    await page.press('#personName', 'Enter')
    await page.mouse.move(900, 600)
    const chip = page.locator('.chip').last()
    const fit = await chip.evaluate((c) => {
      const main = c.querySelector('.chip-main').getBoundingClientRect(), box = c.getBoundingClientRect()
      return { gap: Math.round(box.right - main.right), rail: Math.round(document.querySelector('.roster').getBoundingClientRect().width) }
    })
    if (process.env.LO_SHOTS) await page.locator('.roster').screenshot({ path: process.env.LO_SHOTS + `/${eng}-roster-1440.png` })
    check(eng, '1440: a hidden remove does not narrow the name', fit.gap <= 12, JSON.stringify(fit))
    // Shown (hover, or keyboard focus), the remove sits inside the chip on an
    // opaque backing and the name ends before it, so nothing is drawn under it.
    const covers = (b) => {
      const r = b.getBoundingClientRect(), c = b.closest('.chip').getBoundingClientRect()
      const name = b.closest('.chip').querySelector('.chip-name').getBoundingClientRect()
      const bg = getComputedStyle(b).backgroundColor
      const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1].split(/[ ,/]+/).filter(Boolean)[3]
      return { ok: getComputedStyle(b).opacity === '1' && r.right <= c.right && r.width >= 24 && name.right <= r.left && (alpha === undefined || Number(alpha) === 1),
        name: Math.round(name.right), btn: Math.round(r.left), bg }
    }
    await chip.hover()
    await page.waitForTimeout(400) // the opacity transition
    const shown = await chip.locator('.chip-remove').evaluate(covers)
    if (process.env.LO_SHOTS) await page.locator('.roster').screenshot({ path: process.env.LO_SHOTS + `/${eng}-roster-1440-hover.png` })
    check(eng, '1440: on hover the remove shows inside the chip, clear of the name', shown.ok, JSON.stringify(shown))
    await page.mouse.move(900, 600)
    await chip.locator('.chip-main').focus()
    await page.waitForTimeout(400)
    const focused = await chip.locator('.chip-remove').evaluate(covers)
    if (process.env.LO_SHOTS) await page.locator('.roster').screenshot({ path: process.env.LO_SHOTS + `/${eng}-roster-1440-focus.png` })
    check(eng, '1440: on focus the remove shows clear of the name', focused.ok, JSON.stringify(focused))
    await page.evaluate(() => document.activeElement && document.activeElement.blur())

    // A 400-person team asks first and says how many; declining adds nobody.
    const big = { v: 1, people: Array.from({ length: 400 }, (_, i) => ({ id: 'big-' + i, name: 'Big ' + i })),
      teams: [{ id: 'everyone', name: 'Everyone', members: Array.from({ length: 400 }, (_, i) => ({ person: 'big-' + i })) }] }
    const before = await page.locator('.chip').count()
    await page.evaluate(async (w) => { (await import('/js/settings.js')).addTeam(w) }, big)
    check(eng, 'a 400-person team asks first, with the count', dialogs.length === 1 && /\b400 people\b/.test(dialogs[0]), dialogs.join(' | '))
    check(eng, 'declining adds nobody', (await page.locator('.chip').count()) === before)
    check(eng, 'declining says where the offer lives', /from Settings/.test(await page.locator('.toast-notification').textContent().catch(() => '')))
    answer = true
    await page.evaluate(async (w) => { (await import('/js/settings.js')).addTeam(w) }, big)
    check(eng, 'accepting adds the team', (await page.locator('.chip').count()) === before + 400)
    const small = { v: 1, people: [{ id: 'one', name: 'Only One' }], teams: [{ id: 't', name: 'T', members: [{ person: 'one' }] }] }
    await page.evaluate(async (w) => { (await import('/js/settings.js')).addTeam(w) }, small)
    check(eng, 'a small team adds with no question', dialogs.length === 2 && (await page.locator('.chip').count()) === before + 401)

    // The weekly hours text follows the time format.
    for (const [c, want] of [['h12', '9:00 am to 5:30 pm'], ['h23', '09:00 to 17:30']]) {
      await page.evaluate((k) => { document.cookie = k }, W.meCookie({ h: [540, 1050], d: '12345', c }, LOCAL))
      await reload(page)
      await page.waitForSelector('.neo-ws-gear')
      await page.keyboard.press(',')
      const note = await page.locator('dialog[open] .neo-ws-note', { hasText: 'work week' }).textContent().catch(() => '')
      check(eng, `weekly hours in the ${c} format`, note.includes(want), note)
      await page.keyboard.press('Escape')
    }
    await page.evaluate((k) => { document.cookie = k; localStorage.removeItem('loadout-v1') }, W.clearCookie(W.COOKIE_ME, LOCAL))
    check(eng, 'no page errors in the minors', !errors.length, errors.join('; '))
    await page.close()
  }

  // 8. Analytics on the production hosts (Chromium): no beacon can read a pick's answer.
  if (eng === 'chromium') {
    const prod = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await prod.route(/^https:\/\/loadout\.neorgon\.com\//, async (route) => {
      const u = new URL(route.request().url())
      const res = await fetch(TOOL + u.pathname + u.search)
      await route.fulfill({ status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/html' }, body: Buffer.from(await res.arrayBuffer()) })
    })
    await prod.route(/^https:\/\/(www\.)?neorgon\.com\//, async (route) => {
      const u = new URL(route.request().url())
      const res = await fetch(FRAME + u.pathname + u.search)
      await route.fulfill({ status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/html' }, body: Buffer.from(await res.arrayBuffer()) })
    })
    await prod.route(/^https:\/\/cdn\.neorgon\.org\//, (route) => route.fulfill({ status: 200, body: '' }))
    // Each analytics script records the address when it would run (its load), then is refused.
    await prod.addInitScript(() => {
      window.__beacons = []
      const watch = (el) => {
        if (el && el.tagName === 'SCRIPT' && /goatcounter|zgo\.at|cloudflareinsights/.test(el.src || '')) {
          window.__beacons.push({ at: 'append', href: location.href })
          const note = () => window.__beacons.push({ at: 'run', href: location.href })
          el.addEventListener('load', note); el.addEventListener('error', note)
        }
      }
      const append = Node.prototype.appendChild
      Node.prototype.appendChild = function (el) { watch(el); return append.call(this, el) }
    })
    await prod.route(/zgo\.at|goatcounter\.com|cloudflareinsights\.com/, (route) => setTimeout(() => route.abort(), 50))
    const page = await prod.newPage()
    await page.goto('https://loadout.neorgon.com/')
    await page.evaluate(() => sessionStorage.setItem('neo-ws:return-hash', JSON.stringify({ h: '', t: Date.now(), k: 'pick' })))
    const payload = await W.encodePayload(WS)
    await page.goto('about:blank')
    await page.goto(W.answerLink('https://loadout.neorgon.com/', { payload, stamp: W.makeStamp() }, { selfHostname: 'neorgon.com' }))
    await page.waitForTimeout(1500)
    const beacons = await page.evaluate(() => window.__beacons)
    if (process.env.LO_DEBUG) console.log(await page.evaluate(() => JSON.stringify({ cache: (localStorage.getItem('neo-ws:cache') || '').slice(0, 200), href: location.href, ss: sessionStorage.getItem('neo-ws:return-hash') })))
    const runs = beacons.filter((b) => b.at === 'run')
    check(eng, 'production host: analytics load and the answer is taken', runs.length > 0 && !page.url().includes('neo-ws=') && !!(await page.evaluate(() => localStorage.getItem('neo-ws:cache'))), JSON.stringify(beacons))
    check(eng, 'production host: no beacon runs while the address carries neo-ws=', runs.every((b) => !b.href.includes('neo-ws=')), JSON.stringify(beacons))
    await prod.close()
  }

  await browser.close()
}

stop()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
