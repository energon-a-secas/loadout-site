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
await new Promise((r) => setTimeout(r, 900))

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
    { id: 'lea-muller', name: 'Léa Müller' },
    { id: 'evil', name: XSS, color: 'red;background:url(//x)' },
    { id: 'priya-nair', name: 'Priya Nair' },
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
  await page.goto(TOOL + path)
  await page.evaluate((o) => { localStorage.setItem('neo-ws:dev-origin', o) }, FRAME)
  return { page, errors }
}

async function seedFrame(ctx) {
  const p = await ctx.newPage()
  await p.goto(FRAME + '/workspace/vault.html')
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
    await page.reload()
    await page.waitForSelector('.chip')
    check(eng, 'hostile saved state renders as text', (await page.locator('img[src=x]').count()) === 0 && (await page.locator('.block').count()) === 1 && !errors.length, errors.join('; '))
    await page.evaluate(() => localStorage.removeItem('loadout-v1'))
    await page.close()
  }

  // 2. The frame shares the team (Chromium, Firefox); Add my team brings the payments team with kit faces.
  await seedFrame(ctx)
  {
    const { page, errors } = await open(ctx)
    await page.reload()
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
    await page.reload()
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
    await page.reload()
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
    await page.reload()
    await page.evaluate(() => document.getElementById('sampleBtn').click())
    await page.keyboard.press(',')
    await page.locator('dialog[open] button', { hasText: "Save this board's people" }).click()
    await page.waitForURL(/\/workspace\/#save=/, { timeout: 5000 }).catch(() => {})
    const got = W.parseFragment(new URL(page.url()).hash, { selfHostname: 'localhost' })
    const sent = got && W.decodePayload(got.payload)
    const names = sent ? sent.ws.people.map((p) => p.name) : []
    check(eng, 'save opens the review with the board\'s people', !!got && got.tool === 'loadout' && names.join() === 'Maya Chen,Diego Ruiz,Priya Nair,Tom Weber', page.url().slice(0, 120))
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

  // 7. Phone: remove controls show without hover and are 44px on touch.
  {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: eng !== 'firefox' })
    const { page } = await open(phone)
    await page.reload()
    await page.evaluate(() => document.getElementById('sampleBtn').click())
    const box = await page.locator('.chip-remove').first().boundingBox()
    const op = await page.locator('.chip-remove').first().evaluate((e) => getComputedStyle(e).opacity)
    check(eng, 'phone: chip remove visible and 44px', box && box.width >= 44 && box.height >= 44 && op === '1', JSON.stringify(box) + ' ' + op)
    const tiny = await page.$$eval('body *', (els) => els.filter((e) => e.childElementCount === 0 && e.textContent.trim() && e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.className + ':' + e.textContent.trim().slice(0, 20)))
    check(eng, 'phone: no visible text under 12px', !tiny.length, tiny.slice(0, 5).join(', '))
    await phone.close()
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
