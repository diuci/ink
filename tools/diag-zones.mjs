// 诊断：区域模式停在 intro？404 是什么资源？
// 用法：node tools/diag-zones.mjs
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })

const log = []
page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => log.push(`[pageerror] ${e}`))
page.on('requestfailed', (r) => log.push(`[404?] ${r.url()} — ${r.failure()?.errorText}`))
page.on('response', (r) => { if (r.status() >= 400) log.push(`[HTTP ${r.status()}] ${r.url()}`) })

await page.goto('http://127.0.0.1:8490/?autostart=60&autopilot&mode=zones',
  { waitUntil: 'networkidle2', timeout: 120000 })

for (const t of [3000, 8000, 15000, 25000]) {
  await new Promise((r) => setTimeout(r, t === 3000 ? 3000 : t - (t === 8000 ? 3000 : t === 15000 ? 8000 : 15000)))
  const s = await page.evaluate(`(() => {
    const w = window.__inkwave
    if (!w || !w.match) return { boot: 'no match yet' }
    const m = w.match
    const z = (m.zones && m.zones.zones) || []
    return {
      state: m.state, stateT: Math.round(m.stateT || 0), time: Math.round(m.time || 0),
      zones: z.map(x => ({ id: x.id, owner: x.owner, poemOf: x.owner >= 0 ? x.poem[x.owner] : null })),
      localPoem: m.local && m.local.poem ? m.local.poem.title : null,
      contentVersion: w.contentVersion || null,
    }
  })()`)
  console.log('\n[t=%sms] %s', t, JSON.stringify(s, null, 1))
}

console.log('\n── 控制台/网络 ──')
for (const l of log.slice(0, 30)) console.log(' ', l)
await browser.close()
