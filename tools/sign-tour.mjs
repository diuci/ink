// 丢词大作战 — 场景招牌巡检截图
//
// 用途：汉化招牌之后要**用眼睛**确认三件事——
//   1. 中文真的画出来了（没变成空白板，这是 3D 笔画字形表的经典坑）
//   2. 没撑出牌子（中文比英文宽，牌子尺寸是照英文定的）
//   3. 没有把道具类型名之类的引用改坏导致道具消失
//
// 手法照搬 tools/stage-shots.mjs：接管镜头 rig.cinematic + 冻结主循环，
// 在同一个 task 里 render 完立刻从 canvas 抓帧（preserveDrawingBuffer 是关的，
// 过了合成时刻缓冲区就废了）。
//
// 用法：先起服务 python tools/serve.py 8490
//      node tools/sign-tour.mjs [--only tidewater,cargo] [--shots shots/signs]
import puppeteer from 'puppeteer-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.TOUR_BASE || 'http://127.0.0.1:8490'
const OUT = (process.argv.find((a) => a.startsWith('--shots=')) || '--shots=shots/signs').slice(8)
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const MAPS = ['tidewater', 'kelpline', 'halyard', 'saltpan', 'crossmarket', 'lockgate', 'terraces', 'cargo']
const MAPS_SEL = onlyArg ? onlyArg.slice(7).split(',') : MAPS

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) { console.error('[tour] 找不到 Chrome/Edge'); process.exit(1) }
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--mute-audio'],
})

for (const map of MAPS_SEL) {
  console.log('[tour] ==== ' + map + ' ====')
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
  try {
    // skipTitle + devstage：进 attract 模式直接把这张图摆出来（与 stage-shots 同一套启动参数）
    await page.goto(`${BASE}/?map=${map}&time=day&skipTitle&devstage&shadercheck`, { waitUntil: 'domcontentloaded', timeout: 180000 })
    await page.waitForFunction(
      "window.__inkwave && __inkwave.menus && __inkwave.menus.current === 'main' && window.__G && __G.level && __G.env",
      { timeout: 240000, polling: 300 })
    // 清场 + 接管镜头
    await page.evaluate(`(() => {
      const g = window.__inkwave, G = window.__G
      g.debug.freeze(); g.debug.freezeBots(); g.shotT = 1e9; g.attractT = -1e9
      if (g.fxHooks) g.fxHooks.enabled = false
      for (const id of ['ui-root', 'fade']) { const el = document.getElementById(id); if (el) el.style.display = 'none' }
    })()`)

    const shots = await page.evaluate(`(() => {
      const g = window.__inkwave, G = window.__G
      const V = g.rig.camera.position.constructor
      const B = G.level.bounds
      const cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2
      const spanX = B.maxX - B.minX, spanZ = B.maxZ - B.minZ
      const R = Math.max(spanX, spanZ)
      // 三个角度：高空俯瞰（看整张地图的招牌）+ 两个斜角（看立面文字）
      const cams = [
        { name: 'aerial', pos: [cx - R * 0.55, R * 0.72, cz + R * 0.62], look: [cx, 0, cz], fov: 70 },
        { name: 'low-sw', pos: [cx - R * 0.62, R * 0.16, cz + R * 0.66], look: [cx, R * 0.06, cz], fov: 72 },
        { name: 'low-se', pos: [cx + R * 0.64, R * 0.18, cz + R * 0.60], look: [cx, R * 0.05, cz], fov: 72 },
      ]
      const out = []
      const src = G.renderer.domElement
      for (const cam of cams) {
        const pos = new V(...cam.pos), look = new V(...cam.look)
        G.settings.fov = cam.fov
        const aim = () => { g.rig.trauma = 0; g.rig._traumaIn = 0; g.rig.cinematic(pos, pos, look, look, 1e6) }
        G.projectiles.clear(); G.fx.clear?.(); G.paint.clear()
        aim(); g.debug.step(120)
        G.projectiles.clear(); G.fx.clear?.(); G.paint.clear()
        aim(); g.debug.step(34)
        const c = document.createElement('canvas'); c.width = 1280; c.height = 720
        c.getContext('2d').drawImage(src, 0, 0, 1280, 720)
        out.push({ name: cam.name, url: c.toDataURL('image/png') })
      }
      return out
    })()`)

    for (const s of shots) {
      const p = `${OUT}/${map}-${s.name}.png`
      writeFileSync(p, Buffer.from(s.url.split(',')[1], 'base64'))
      console.log('   ' + p)
    }
    if (errs.length) console.log('   页面错误: ' + errs.slice(0, 3).join(' | '))
  } catch (e) {
    console.log('   失败: ' + String(e).slice(0, 200))
  }
  await page.close()
}
await browser.close()
console.log('[tour] 完成，输出目录 ' + OUT)
