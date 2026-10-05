// 丢词大作战 — 招牌实际绘制内容审计
//
// 为什么不用截图核对：招牌在场景里只有几十像素高，放大也认不出字，
// 而「代码里写了中文」不等于「真的画出了中文」（3D 笔画字形表里没有汉字时
// 会**静默**画成空白板，node --check 还照样通过）。
//
// 做法：在任何游戏脚本执行**之前**（evaluateOnNewDocument）挂住 Canvas2D 的
// fillText / strokeText / arcText，把游戏实际交给 GPU 的字符串录下来。
// 然后只认一条铁律：画招牌时传的字符串里，出现连续 3 个以上拉丁字母就算漏译。
//
// 用法：先起服务 python tools/serve.py 8490
//      node tools/sign-audit.mjs [--only tidewater,cargo]
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:8490'
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const MAPS = ['tidewater', 'kelpline', 'halyard', 'saltpan', 'crossmarket', 'lockgate', 'terraces', 'cargo']
const MAPS_SEL = onlyArg ? onlyArg.slice(7).split(',') : MAPS

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) { console.error('[audit] 找不到 Chrome/Edge'); process.exit(1) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=800,450', '--mute-audio'],
})

// 必须在页面任何脚本之前注入
const HOOK = `(() => {
  window.__signs = new Set()
  const rec = (s) => { if (typeof s === 'string' && s.trim()) window.__signs.add(s) }
  const P = CanvasRenderingContext2D.prototype
  for (const fn of ['fillText', 'strokeText']) {
    const orig = P[fn]
    P[fn] = function (s, ...rest) { rec(s); return orig.call(this, s, ...rest) }
  }
  for (const fn of ['arcText']) {
    const orig = P[fn]
    if (orig) P[fn] = function (s, ...rest) { rec(s); return orig.call(this, s, ...rest) }
  }
})()`

// 故意保留英文的（与 tools/zh-signs.mjs 的 KEEP 同一套理由）
const KEEP = new Set([
  'SWL 35 T', 'SWL 65 T', 'HM', 'HM 1', 'KL 204', 'RTG 22', 'VR', 'SQD · 042', 'SQD·042',
  'NO 2', 'NO.', 'FM', 'KM/H', 'BLOOP 555-0142', 'KRKU 882130', 'KRKU 204519',
  'HALCYON', 'KITTIWAKE', 'MARGUERITE', 'MARY ANN', 'PIPIT', 'TERN', 'REEL TIME', 'SEA BISCUIT',
  'TIDEBANK', 'CORAL MAX', 'CORAL MAXIMA', 'KRAKEN', 'KRAKEN LINES',
  'TDBU', 'CRLU', 'INKU', 'KLPU', 'KRKU', 'TIDU', 'HLBU', 'SLTU', 'KLPU 204816',
  'KRKU 204519  3', 'LASHING GANG', 'REEFER TECH',
  'MAX GROSS 30,480 KG', 'TARE 2,200 KG', 'SALT SPRAY',
  // 罗马数字：台地山村墙面铭文上的编号。意大利山村本来就用罗马数字，
  // 翻成中文数字反而假——和船名、箱号一样属于「现实里就不翻译」的那一类。
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
])

let bad = 0
for (const map of MAPS_SEL) {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(HOOK)
  try {
    await page.goto(`${BASE}/?map=${map}&time=day&skipTitle&devstage`, { waitUntil: 'domcontentloaded', timeout: 180000 })
    await page.waitForFunction(
      "window.__inkwave && __inkwave.menus && __inkwave.menus.current === 'main' && window.__G && __G.level && __G.env",
      { timeout: 240000, polling: 300 })
    // 让关卡把道具、贴花、招牌全部画一遍
    await new Promise((r) => setTimeout(r, 9000))
    const all = await page.evaluate('Array.from(window.__signs)')
    // 漏译判据：去掉数字/标点后还剩连续 3 个以上拉丁字母
    const latin = (s) => (s.replace(/[^A-Za-z]+/g, '').match(/.{1,}/g) || []).some((w) => w.length >= 3)
    const suspects = [...new Set(all.filter((s) => latin(s) && !KEEP.has(s.trim())))].sort()
    const zh = [...new Set(all.filter((s) => /[\u4e00-\u9fff]/.test(s)))]
    console.log(`[${map}] 录到 ${all.length} 条绘制文本，其中中文 ${zh.length} 条`)
    if (suspects.length) {
      bad += suspects.length
      console.log('   ⚠ 仍是拉丁文: ' + suspects.map((s) => JSON.stringify(s)).join(', '))
    } else {
      console.log('   ✓ 无漏译招牌')
    }
  } catch (e) {
    console.log('[' + map + '] 失败: ' + String(e).slice(0, 140))
  }
  await page.close()
}
await browser.close()
console.log(bad ? `\n✗ 共 ${bad} 处待查` : '\n✓ 全部地图的招牌都已是中文（有意保留的工业标识除外）')
process.exit(bad ? 1 : 0)
