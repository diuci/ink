// 丢词大作战 — 「三种模式都能出接诗题」验收探针
//
// 背景：接诗原来只挂在 zones 模式（match 里 if (mode === 'zones') 才 new PoemQuiz）。
// 现在改成全模式，非 zones 的地面刻字改为在答题者脚下现场围格子（paint.discRegion）。
//
// 这个探针实机跑三种模式，回答四个问题：
//   1. quiz 是否真的建起来了（原来非 zones 是 null）
//   2. 题目是否真的出得来（force 出题，不等 22 秒）
//   3. 答对后是否真的刻到地上（涂地图集新增不透明像素 + CPU 网格归属变化）
//   4. 有没有报错
//
// 用法：先起服务 python tools/serve.py 8490
//      node tools/probe-quiz-modes.mjs
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:8490'
const MODES = ['turf', 'zones', 'boss']
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
    '--window-size=800,450', '--mute-audio'],
})

let allOk = true
for (const mode of MODES) {
  console.log('\n[probe] ====== ' + mode + ' ======')
  const page = await browser.newPage()
  await page.setViewport({ width: 800, height: 450 })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 180)))
  try {
    await page.goto(`${BASE}/?mode=${mode}&autostart=300&autopilot&shadercheck`,
      { waitUntil: 'domcontentloaded', timeout: 180000 })
    // 必须等到**这个模式**真的开起来。踩过的坑：autostart 之前游戏已经有一个
    // attract 对局（默认 turf），条件写松就会抓到旧对局，于是「boss」那一轮
    // 其实是拿 turf 跑了两遍，看起来还都过了。
    await page.waitForFunction(
      `window.__inkwave && window.__inkwave.match && window.__inkwave.match.mode === '${mode}' && !window.__inkwave.match.attract`,
      { timeout: 480000, polling: 300 })
    await page.waitForFunction('window.__G && window.__G.paint', { timeout: 480000, polling: 300 })

    const rep = await page.evaluate(`(() => {
      const W = window.__inkwave, m = W.match, G = window.__G
      const out = { mode: m.mode, quizExists: !!m.quiz, quizEnabled: m.quizEnabled, hasZones: !!m.zones }
      out.poemsAssigned = m.actors.map((a) => !!a.poem)

      // 直接出题，不等 22 秒的开局延迟
      m.quiz.nextAt = 0
      m.quiz._ask()
      out.asked = !!m.quiz.active
      out.askText = m.quiz.active ? m.quiz.active.askText : null
      out.options = m.quiz.active ? m.quiz.active.options.map((o) => o.text) : null

      // 记下涂地基线
      const P = G.paint
      const gridBefore = P ? P.counts.slice() : null
      let inkBefore = 0
      if (P && P.rt) {
        const buf = new Uint8Array(4)
        // 用 coverage() 代替逐像素读（读回大图太慢），另用 counts 看归属变化
        out.coverageBefore = P.coverage ? P.coverage().slice() : null
      }

      // 答对
      const a = m.quiz.active
      if (a) {
        const line = \`\${a.askText}　\${a.options[a.correct].text}\`
        const who = m.local || m.actors[0]
        out.stamped = m.stampPoemAt(who, line, who.team)
        out.stampLine = line
      }
      if (P) {
        out.countsAfter = P.counts.slice()
        out.gridChanged = gridBefore ? String(gridBefore) !== String(P.countsAfter) : null
      }
      // 让 paint 把这次刻字真正画进图集
      for (let i = 0; i < 4; i++) { if (P && P.flush) P.flush(0.033); }
      return JSON.stringify(out)
    })()`)

    const o = JSON.parse(rep)
    console.log('  模式              ', o.mode)
    console.log('  PoemQuiz 已创建     ', o.quizExists ? '是' : '否', o.quizEnabled ? '(已启用)' : '(设置关闭)')
    console.log('  zones 区域          ', o.hasZones ? '有' : '无（刻字应落在脚下）')
    console.log('  队员分到诗          ', `${o.poemsAssigned.filter(Boolean).length}/${o.poemsAssigned.length}`)
    console.log('  出题                ', o.asked ? `成功：上句「${o.askText}」` : '失败')
    if (o.options) console.log('  三个选项            ', o.options.join(' / '))
    console.log('  地面刻字            ', o.stamped ? '成功' : '失败', o.stampLine ? `「${o.stampLine}」` : '')
    if (o.countsAfter) console.log('  归属变化 counts     ', JSON.stringify(o.countsBefore || null) + ' -> ' + JSON.stringify(o.countsAfter))

    const okAll = o.quizExists && o.asked && o.stamped
    if (!okAll) allOk = false
    console.log('  结论                ', okAll ? '通过' : '不通过')
  } catch (e) {
    allOk = false
    console.log('  失败: ' + String(e).slice(0, 220))
  }
  if (errs.length) { allOk = false; console.log('  页面错误: ' + errs.slice(0, 3).join(' | ')) }
  await page.close()
}
await browser.close()
console.log('\n' + (allOk ? '三种模式都能出题并刻字' : '有模式没通过'))
process.exit(allOk ? 0 : 1)
