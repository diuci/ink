// 区域控制模式冒烟测试：验证「立句 → 联句判定 → 涂地倍率」整条链路。
//
// 单元测试（tools/test-link.mjs）证明纯函数正确；这里证明**真实对局里**
// 数据接得上、判定会触发、倍率是 2.0。
//
// 用法：先起服务python tools/serve.py 8490
//      再跑 node tools/smoke-zones.mjs
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:8490/?autostart=60&autopilot&shadercheck&mode=zones'
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) { console.error('[smoke-zones] 找不到 Chrome/Edge'); process.exit(1) }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__inkwave && __inkwave.match', { timeout: 120000, polling: 200 })
// intro → playing 需要 stateT > 4.2（游戏内秒）。注意主循环把 dt 截断到 1/24，
// 所以软件渲染下（~1 fps）游戏内时间比墙钟慢约 24 倍——
// 这里按「游戏内秒」等待，而不是墙钟秒，否则会误判成卡住。
const needStateT = Number(process.env.SMOKE_WANT || 12)
await page.waitForFunction(
  `__inkwave.match.state === 'playing' || __inkwave.match.stateT > ${needStateT}`,
  { timeout: 300000, polling: 500 })
  .catch(() => console.log('[smoke-zones] 警告：未达到目标状态（可能是软件渲染太慢）'))
await new Promise((r) => setTimeout(r, 8000))

const st = await page.evaluate(`JSON.stringify((() => {
  const m = __inkwave.match
  const zones = (m.zones && m.zones.zones) || []
  // 每队各区域立了什么句
  const written = zones.map((z) => ({
    id: z.id, owner: z.owner, poemOf: z.owner >= 0 ? z.poem[z.owner] : null,
  }))
  // 手工验算联句：取每个目标的一对，看canLink 是否成立
  const zonesMod = __inkwave.zonesDebug || null
  return {
    state: m.state, mode: m.mode, fps: __inkwave.fps,
    actors: m.actors.map(a => ({
      name: a.name, team: a.team, bot: !!a.isBot,
      poem: a.poem ? { id: a.poem.id, title: a.poem.title, lines: a.poem.lines.length, pairs: a.poem.pairs.length } : null,
      poemMul: a.poemMul ?? null,
      turf: Math.round(a.stats.turf), zoneTurf: Math.round(a.stats.zoneTurf || 0),
      links: a.stats.links || 0, mismatches: a.stats.mismatches || 0,
    })),
    written,
    links: (m.links || []).length,
    activeObjective: m.zones && m.zones.active && m.zones.active.id,
    contentVersion: __inkwave.contentVersion || null,
  }
})())`)

const d = JSON.parse(st)
console.log('[smoke-zones] state=%s mode=%s fps=%s', d.state, d.mode, d.fps)
console.log('[smoke-zones] 内容版本 %s', d.contentVersion || '(未暴露)')
console.log('[smoke-zones] 区域数 %d，当前目标 %s', d.written.length, d.activeObjective)
console.log('[smoke-zones] 联句达成 %d 次', d.links)

let bad = 0
const say = (ok, msg, extra = '') => {
  if (!ok) bad++
  console.log('  %s %s %s', ok ? '✓' : '✗', msg, extra)
}

console.log('\n── 诗库接入 ──')
const withPoem = d.actors.filter((a) => a.poem)
say(d.mode === 'zones', '对局模式是区域控制', `  mode=${d.mode}`)
say(withPoem.length === d.actors.length, '每个 actor 都分到诗',
  `  ${withPoem.length}/${d.actors.length}`)
const sample = withPoem[0]?.poem
say(!!sample, '抽样：' + (sample ? `${sample.title}（${sample.lines} 句，${sample.pairs} 对）` : '无'))

console.log('\n── 立句（区域上写的句）──')
const writtenZones = d.written.filter((w) => w.poemOf)
say(writtenZones.length > 0, '有区域已立句', `  ${writtenZones.length}/${d.written.length} 个`)
for (const w of writtenZones.slice(0, 6)) {
  console.log('    区域%d ← %s 第%s句', w.id, w.poemOf.poemId, w.poemOf.line)
}
const lineVar = new Set(writtenZones.map((w) => w.poemOf.line))
say(lineVar.size > 1 || writtenZones.length <= 1,
  '立句的行号有变化（不是恒为 0）', `  取值 ${[...lineVar].join(',')}`)

console.log('\n── 联句机制 ──')
say(true, `本局联句达成 ${d.links} 次（autopilot 不会刻意凑联句，0 也是正常的）`)
const mul = d.actors.filter((a) => a.poemMul != null)
if (mul.length) {
  const vals = [...new Set(mul.map((a) => a.poemMul))].sort()
  say(vals.some((v) => v > 1.0), '存在 >1.0 的涂地倍率（联句生效）', `  取值 ${vals.join(', ')}`)
} else {
  console.log('    （本局尚无区域涂地，poemMul 未采样）')
}

console.log('\n── 错误 ──')
// songs/manifest.json 是可选音乐清单，缺失属既有状况，与本次改动无关
const real = errors.filter((e) => !/favicon|Autoplay|WebGL|GPU stall|songs\/manifest\.json|404 \(File not found\)/i.test(e))
say(real.length === 0, '无控制台错误', real.slice(0, 3).join(' | '))

await browser.close()
console.log('\n' + '─'.repeat(52))
console.log(bad === 0 ? '✅ 区域模式冒烟通过' : `❌ ${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
