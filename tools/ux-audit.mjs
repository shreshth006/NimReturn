/**
 * Walks NimReturn the way a judge would, at phone size, and reports what is broken or
 * confusing. Run it after any UI change:
 *
 *   node tools/ux-audit.mjs                     # audit the deployed staging app
 *   NR_BASE=http://localhost:5173 node tools/ux-audit.mjs
 *
 * It writes a screenshot per screen to tools/.audit/ and prints findings grouped by
 * severity. Findings are measured, not guessed: overflow, tap targets, text size,
 * contrast, dead ends, and whether each screen offers an obvious next action.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.NR_BASE ?? 'https://nimreturn-staging-cycle2.onrender.com').replace(/\/$/u, '')
const OUT = new URL('./.audit/', import.meta.url).pathname
const PORT = Number(process.env.NR_CDP_PORT ?? 9344)
const MIN_TAP = 44
const MIN_TEXT = 11  // uppercase labels sit at 11.2px by design; below 11 is a real problem

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- CDP plumbing
async function launch() {
  const dir = mkdtempSync(join(tmpdir(), 'nr-audit-'))
  const proc = spawn('google-chrome', [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--force-color-profile=srgb',
  ], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      return { proc, wsUrl: version.webSocketDebuggerUrl }
    } catch { await sleep(250) }
  }
  throw new Error('Chrome did not start')
}

class Page {
  constructor(ws, sessionId) { this.ws = ws; this.sessionId = sessionId; this.id = 0; this.pending = new Map() }

  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    const page = new Page(ws)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      const waiter = msg.id && page.pending.get(msg.id)
      if (!waiter) return
      page.pending.delete(msg.id)
      msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result)
    }
    const { targetId } = await page.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await page.send('Target.attachToTarget', { targetId, flatten: true })
    page.sessionId = sessionId
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 360, height: 780, deviceScaleFactor: 3, mobile: true,
      screenOrientation: { angle: 0, type: 'portraitPrimary' },
    })
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
    })
    return page
  }

  send(method, params = {}) {
    const id = ++this.id
    const payload = { id, method, params }
    if (this.sessionId) payload.sessionId = this.sessionId
    this.ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`, returnByValue: true, awaitPromise: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.text)
    return result.value
  }

  async goto(path) {
    await this.send('Page.navigate', { url: path.startsWith('http') ? path : BASE + path })
    for (let i = 0; i < 80; i++) {
      await sleep(500)
      const state = await this.eval(`
        const t = document.body ? document.body.innerText : ''
        if (/START BUILDING ON RENDER/i.test(t)) return 'interstitial'
        return document.querySelector('main') && t.trim().length > 40 ? 'ready' : 'waiting'
      `)
      if (state === 'ready') { await sleep(800); return }
    }
    throw new Error(`page never became ready: ${path}`)
  }

  async shot(name) {
    const height = await this.eval('return Math.ceil(document.documentElement.scrollHeight);')
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 360, height: Math.min(height, 6000), scale: 1 },
    })
    writeFileSync(`${OUT}${name}.png`, Buffer.from(data, 'base64'))
  }
}

// ---------------------------------------------------------------- the checks
const CHECKS = `
  const findings = []
  const vw = document.documentElement.clientWidth
  const add = (severity, rule, detail, el) => findings.push({
    severity, rule, detail,
    where: el ? (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 55) : '',
  })

  if (document.documentElement.scrollWidth > vw + 1) {
    add('high', 'horizontal-scroll', \`page is \${document.documentElement.scrollWidth}px wide on a \${vw}px screen\`, null)
  }

  const seenText = new Set()
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden') continue
    const leaf = el.children.length === 0
    const label = (el.innerText || '').trim()

    if (r.right > vw + 1 && (leaf || r.width > vw + 1)) {
      add('high', 'clipped-element', \`extends to \${Math.round(r.right)}px past a \${vw}px screen\`, el)
    }

    const tappable = ['A', 'BUTTON', 'SUMMARY', 'SELECT'].includes(el.tagName)
      || (el.tagName === 'INPUT' && !['hidden'].includes(el.type))
    if (tappable && (r.height < ${MIN_TAP} || r.width < ${MIN_TAP})) {
      const severity = r.height < 30 ? 'high' : 'medium'
      add(severity, 'small-tap-target', \`\${Math.round(r.width)}x\${Math.round(r.height)}, want \${${MIN_TAP}}px\`, el)
    }

    const size = Number.parseFloat(cs.fontSize)
    if (leaf && label && size < ${MIN_TEXT} && !seenText.has(label)) {
      seenText.add(label)
      add('low', 'small-text', \`\${size.toFixed(1)}px\`, el)
    }

    if (leaf && label.length > 24 && !label.includes(' ')
        && cs.overflowWrap !== 'anywhere' && cs.wordBreak !== 'break-all') {
      add('medium', 'unbreakable-string', \`\${label.length} chars with no wrap rule\`, el)
    }

    if (el.tagName === 'IMG' && !el.hasAttribute('alt')) add('medium', 'image-without-alt', el.src.slice(-40), el)
  }

  // A screen that offers nothing to do next is a dead end.
  const actions = [...document.querySelectorAll('main a[href], main button:not([disabled])')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
  if (actions.length === 0) add('high', 'dead-end', 'no enabled link or button on the screen', null)

  if (document.querySelectorAll('h1').length !== 1) {
    add('medium', 'heading-structure', \`\${document.querySelectorAll('h1').length} h1 elements\`, null)
  }

  // Anything that reads like a placeholder should never reach a judge.
  const body = document.body.innerText
  for (const word of ['lorem ipsum', 'TODO', 'FIXME', 'undefined', 'NaN', '[object Object]']) {
    if (body.includes(word)) add('high', 'placeholder-text', \`page contains "\${word}"\`, null)
  }

  return {
    title: document.title,
    height: Math.ceil(document.documentElement.scrollHeight),
    actions: actions.slice(0, 6).map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 40)),
    findings,
  }
`

// ---------------------------------------------------------------- the journey
mkdirSync(OUT, { recursive: true })
const { proc, wsUrl } = await launch()
const page = await Page.open(wsUrl)
const links = `return [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/?'));`

await page.goto('/')
const homeLinks = await page.eval(links)
const screens = [
  ['landing', '/'],
  ['merchant-studio', '/?sell=1'],
]
const passport = homeLinks.find((h) => h.includes('passport='))
const product = homeLinks.find((h) => h.includes('product='))
if (passport) screens.push(['passport-example', passport])
if (product) screens.push(['product', product])
// Every product the merchant sells, so a second chain's page is audited too.
for (const extra of (process.env.NR_EXTRA_SCREENS ?? '').split(',').map((v) => v.trim()).filter(Boolean)) {
  screens.push([`extra-${extra.replace(/[^a-z0-9]+/giu, '-').slice(0, 24)}`, extra])
}

let total = 0
const bySeverity = { high: 0, medium: 0, low: 0 }

for (const [name, path] of screens) {
  await page.goto(path)
  if (name === 'passport-example') {
    const merchant = (await page.eval(links)).find((h) => h.includes('merchant='))
    if (merchant) screens.push(['promise-ledger', merchant])
  }
  const report = await page.eval(CHECKS)
  await page.shot(name)

  console.log(`\n── ${name}  ${path}`)
  console.log(`   ${report.height}px tall · next actions: ${report.actions.join(' | ') || 'NONE'}`)
  const order = { high: 0, medium: 1, low: 2 }
  const sorted = [...report.findings].sort((a, b) => order[a.severity] - order[b.severity])
  if (sorted.length === 0) console.log('   clean')
  for (const f of sorted) {
    total += 1
    bySeverity[f.severity] += 1
    const where = f.where ? `  «${f.where}»` : ''
    console.log(`   [${f.severity.toUpperCase()}] ${f.rule}: ${f.detail}${where}`)
  }
}

console.log(`\n${total} findings — ${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low`)
console.log(`screenshots in ${OUT}`)
proc.kill()
process.exit(bySeverity.high > 0 ? 1 : 0)
