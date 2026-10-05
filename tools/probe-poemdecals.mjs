// 丢词大作战 — 地面诗句贴花（poemDecals）渲染探针 v2
//
// v1 的问题：等 AI 队伍把区域涂到 80% 占领，软件渲染下 420 秒都不够，
// 于是三个区域全是 owner=-1，贴花路径根本没被触发，结论无效。
//
// v2 直接驱动**生产代码本身**：把区域判给某队（z.owner = 0），再调用
// __inkwave._updatePoemDecals()——这正是 main.js 每帧在调的那个函数。
// 这样测的是真实链路，而不是另写一套模拟。
//
// 三层取证：
//   A. 数据层：slots 有内容？画布上真画出字了吗（逐条带统计非透明像素）
//   B. 管线层：uPoem 纹理绑定？uPoemSlot 槽位非零？
//   C. 画面层：把镜头挪到区域上方截图——这才是最终答案
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

const URL = process.env.PROBE_URL || 'http://127.0.0.1:8490/?autostart=300&autopilot&shadercheck&mode=zones'
const OUT = process.env.PROBE_OUT || 'shots/probe-poemdecals2.png'
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) { console.error('[probe] 找不到 Chrome/Edge'); process.exit(1) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

console.log('[probe] 打开', URL)
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction('window.__inkwave && __inkwave.match && __inkwave.match.zones && __inkwave.poemDecals', { timeout: 240000, polling: 200 })
console.log('[probe] match 与 PoemDecals 就绪')

// —— 直接驱动生产路径：把区域判给甲队，然后调 main.js 每帧在调的那个函数 ——
const forced = await page.evaluate(`(() => {
  const W = window.__inkwave, Z = W.match.zones
  const n = Z.zones.length, out = []
  for (let i = 0; i < n; i++) {
    const z = Z.zones[i]
    if (!z || z.owner >= 0) continue
    if (!z.poem || !z.poem[0]) continue      // 该队还没立句就跳过
    z.owner = 0
    z._decalKey = null                      // 强制重画
    out.push({ zone: i, poem: z.poem[0].poemId, line: z.poem[0].line })
  }
  W._updatePoemDecals(0.016)               // ← 生产路径
  return out
})()`)
console.log('[probe] 强制占领的区域:', JSON.stringify(forced))

await new Promise((r) => setTimeout(r, 2500))

const rep = await page.evaluate(`JSON.stringify((() => {
  const W = window.__inkwave, D = W.poemDecals
  const u = W.levelMat && W.levelMat.userData && W.levelMat.userData.uniforms
  const out = { slots: [], bandPainted: [], totalPainted: 0 }
  for (let i = 0; i < D.slots.length; i++) {
    const s = D.slots[i]
    if (s) out.slots.push({ slot: i, poemId: s.poemId, line: s.line, team: s.team })
  }
  const cv = D.canvas, g = cv.getContext('2d')
  const img = g.getImageData(0, 0, cv.width, cv.height).data
  const band = Math.floor(cv.height / 12)
  for (let b = 0; b < 12; b++) {
    let c = 0
    for (let y = b * band; y < (b + 1) * band; y++)
      for (let x = 0; x < cv.width; x++)
        if (img[(y * cv.width + x) * 4 + 3] > 8) c++
    if (c) out.bandPainted.push({ band: b, px: c })
    out.totalPainted += c
  }
  out.uPoemBound = !!(u && u.uPoem && u.uPoem.value)
  out.slotsU = []
  if (u && u.uPoemSlot) for (let i = 0; i < u.uPoemSlot.value.length; i++) {
    const v = u.uPoemSlot.value[i]
    if (v && (v.x || v.z || v.w)) out.slotsU.push({ i, x: +v.x.toFixed(1), z: +v.z.toFixed(1), w: +v.w.toFixed(2) })
  }
  return out
})())`)

const o = JSON.parse(rep)
console.log('\n[probe] ==== A. 数据层 ====')
console.log('  槽位内容:', JSON.stringify(o.slots))
console.log('  画布非透明像素:', o.totalPainted)
console.log('  分条带:', JSON.stringify(o.bandPainted))
console.log('[probe] ==== B. 管线层 ====')
console.log('  uPoem 已绑定:', o.uPoemBound)
console.log('  uPoemSlot 非零:', JSON.stringify(o.slotsU))

// —— C. 画面层：把本地玩家挪到区域上方，镜头俯视地面 ——
const moved = await page.evaluate(`(() => {
  const W = window.__inkwave, Z = W.match.zones
  const z = Z.zones.find((q) => q && q.owner >= 0)
  if (!z) return null
  const p = W.match.local
  if (!p || !p.pos) return null
  p.pos.set(z.center[0], z.center[1] + 7, z.center[2] + 9)
  if (p.vel) p.vel.set(0, 0, 0)
  return { x: z.center[0], y: z.center[1], z: z.center[2] }
})()`)
console.log('[probe] 镜头目标区域:', JSON.stringify(moved))
await new Promise((r) => setTimeout(r, 6000))
await page.screenshot({ path: OUT })
console.log('[probe] 截图:', OUT)
if (errors.length) console.log('[probe] 页面错误:', errors.slice(0, 5).join(' | '))

const dataOK = o.totalPainted > 0
const pipeOK = o.uPoemBound && o.slotsU.length > 0
console.log('\n[probe] 结论: ' +
  (dataOK ? '贴花已画进画布 ✓' : '画布是空的 ✗') + ' / ' +
  (pipeOK ? '管线已连通 ✓' : '管线未连通 ✗') +
  '\n[probe] 请人工看截图 ' + OUT + ' 确认地面是否真的有字（最终以画面为准）')
await browser.close()
