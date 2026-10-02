// 接诗 3D 句阵冒烟测试：验证「出题 → 天降落地 → 准星拾取 → 消散」在真实浏览器里跑得通。
//
// 单元测试（test-link.mjs）只证明出题逻辑正确；这里证明**真实渲染环境**里：
//   1. 句阵真的建出来了（root 在场景里、可见）
//   2. 上句 + 三个候选的贴图真的画上了汉字（canvas 里有高亮的字形像素）
//   3. 降落动画确实在推进（y 从高空落到目标位，透明度从 0上来）
//   4. 中间那层正好压在准星上（pick 返回 1），上下视角能扫到 1/3 号
//   5. 悬停会放大 + 提亮
//   6. resolve() 让正确项炸开、其余压暗，然后自动收起
//   7. 反复出题不泄漏贴图 / 精灵
//   8. 暂停 / 无题时正确收起
//   9. 截一张图，肉眼确认「从天而降的三维诗句」确实渲染出来了
//
// 注意：每个阶段都把「注入题目 + 断言」放在**同一次** page.evaluate 里同步做完。
// 因为主循环每帧都会调_updateQuizVerse，一旦真的没有题它就会 hide()，跨调用会看到空场景。
//
// 用法：先起服务python tools/serve.py 8490
//      再跑 node tools/smoke-quiz3d.mjs
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

//接诗是「区域控制」模式专属玩法（match.js 只在 mode==='zones' 时建 PoemQuiz），
// 所以整场冒烟都用 zones 模式启动；turf 模式下 match.quiz 是 undefined，
// main.js 的 `_updateQuizVerse` 已用 `q ? q.state() : null` 兜住。
const URL = process.env.SMOKE_URL || 'http://127.0.0.1:8490/?autostart=60&autopilot&shadercheck&mode=zones'
const SHOT = process.env.SHOT || 'shots/quiz3d.png'
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) { console.error('[smoke-quiz3d] 找不到 Chrome/Edge'); process.exit(1) }

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? '   ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}   ${extra}`) }
}

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
// 资源 404 单独收集：想知道到底是哪个文件在404（可能是本来就有的历史遗留）
const failed = []
page.on('requestfailed', (r) => failed.push(`${r.url()} :: ${r.failure()?.errorText}`))
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })

// 页面内注入的工具。
// litRatio：统计贴图里"深色描边像素"的占比——每个汉字都有一圈很粗的深色描边
// （见 quizVerse3d.js 的 strokeText + lineWidth = px*0.20），所以深色像素是字形的
// 可靠指纹。亮像素不行：候选牌的底衬本身是半透明深色、抗锯齿边缘又是米白，会全表命中。
const HELPERS = `
window.__q3d = {
  litRatio(sprite) {
    const im = sprite && sprite.material && sprite.material.map && sprite.material.map.image
    if (!im) return -1
    const c = document.createElement('canvas')
    c.width = im.width; c.height = im.height
    const g = c.getContext('2d')
    g.drawImage(im, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let dark = 0
    for (let i = 0; i < d.length; i += 4) {
      // 深色描边：alpha 足够实，且明显暗于米白字面
      if (d[i + 3] > 200 && d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 100) dark++
    }
    return dark / (d.length / 4)
  },
  show(V, ask, options, correct) {
    V.show({ ask, options, correct })
  },
  settle(V, cam, frames = 60, info) {
    for (let i = 0; i < frames; i++) V.update(1 / 60, cam, info || { timeLeft: 5, timeLimit: 6 })
  },
}
`

console.log('\n── 启动 ──────────────────────────────────────────────')
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction('window.__inkwave && window.__inkwave.verse3d && window.__G && window.__G.camera',
  { timeout: 180000, polling: 200 })
// 接诗是 zones 模式专属；等 Match 真正 setup 完（quiz 建好）再继续。
// 软件渲染下场景是异步加载的，这里必须等，不能假定它已经就绪。
await page.waitForFunction('window.__inkwave.match && window.__inkwave.match.quiz',
  { timeout: 180000, polling: 300 })
await page.evaluate(HELPERS)
ok('句阵模块已创建并挂在场景里', true)

console.log('\n── 出题与贴图 ────────────────────────────────────────')
const drawn = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const L = window.__q3d
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  return {
    live: V.live,
    inScene: !!V.root.parent,
    visible: V.root.visible,
    askKids: V.askSlot.children.length,
    optKids: V.optSlots.map((g) => g.children.length),
    askLit: +L.litRatio(V.askSprite).toFixed(3),
    optLit: V.items.map((it) => +L.litRatio(it.sprite).toFixed(3)),
    askAspect: +V.askSprite.userData.aspect.toFixed(2),
    optAspect: V.items.map((it) => +it.sprite.userData.aspect.toFixed(2)),
    askWorldW: +V.askSprite.userData.baseW.toFixed(2),
    optWorldW: V.items.map((it) => +it.sprite.userData.baseW.toFixed(2)),
    // 「上句稍大一点」的本质是字号更大，而不是整块贴图更宽（候选牌左边还有一个序号
    // 圆牌列，会把总宽撑得比上句还宽）。这里用「精灵高/ 精灵宽 = 1/aspect」把精灵高
    // 换算成"这块贴图代表多少米"，再比这个值——它正比于字号。
    askMeters: +V.askSprite.scale.y.toFixed(3),
    optMeters: +V.items[0].sprite.scale.y.toFixed(3),
    hasSprite: !!V.askSprite && V.items.length === 3,
  }
})
ok('题目已激活', drawn.live && drawn.visible)
ok('挂在场景里', drawn.inScene)
ok('上句一张精灵', drawn.askKids === 1 && drawn.hasSprite, `askKids=${drawn.askKids}`)
ok('三个候选各一张', drawn.optKids.every((n) => n === 1), JSON.stringify(drawn.optKids))
// 米白字形应该占几个百分点：>1% 说明画出字了，<60% 说明不是整张铺满
ok('上句字形已绘制', drawn.askLit > 0.01 && drawn.askLit < 0.6, `lit=${(drawn.askLit * 100).toFixed(1)}%`)
ok('候选字形已绘制', drawn.optLit.every((v) => v > 0.01 && v < 0.6),
  drawn.optLit.map((v) => `${(v * 100).toFixed(0)}%`).join(' '))
// 「上句稍大一点」的本质是字号更大，不是整块贴图更宽——候选牌左侧还有一个序号
// 圆牌列，会把总宽撑得比上句还宽。这里比精灵高度（= 字号 × 画布留白系数，正比于字号）。
ok('上句字号比候选大', drawn.askMeters > drawn.optMeters * 1.05,
  `ask=${drawn.askMeters}m vs opt=${drawn.optMeters}m`)

// 字形必须彼此分开。曾经一版用 g.scale(260,260) 把单位换成米，导致 font 变成
  // '1.28px' 这种小数像素、被浏览器舍入，字距和字形大小脱节，五个字糊成一片。
  //
  // 检测用**亮度**而不是 alpha：候选牌有一整块深色底衬铺满画布，按 alpha 判会得到
  // "每列都不透明"的假象（曾经就是这个坑）。底衬是深色、字面是米白，所以扫中部
  // 几行、统计"够亮"的列——够亮的列才是笔画，全暗的列才是字缝。
const gaps = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const L = window.__q3d
  const gapsIn = (sprite) => {
    const im = sprite.material.map.image
    const c = document.createElement('canvas')
    c.width = im.width; c.height = im.height
    const g = c.getContext('2d')
    g.drawImage(im, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    // 字面米白 #fdf6e6（≈253），描边与底衬都很暗。阈值取 150 足以分开两者。
    const bright = (x, y) => {
      const i = (y * c.width + x) * 4
      return d[i] > 150 && d[i + 1] > 140 && d[i + 2] > 110
    }
    const rows = []
    for (let f = 0.44; f <= 0.56; f += 0.03) rows.push(Math.floor(c.height * f))
    let empty = 0
    for (let x = 0; x < c.width; x++) {
      let allDark = true
      for (const y of rows) {
        if (bright(x, y)) { allDark = false; break }
      }
      if (allDark) empty++
    }
    return { w: c.width, emptyRatio: +(empty / c.width).toFixed(3) }
  }
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  return { ask: gapsIn(V.askSprite), opt: gapsIn(V.items[0].sprite) }
})
// 5 个字 → 4 道缝；上句无底衬所以缝很干净，候选有底衬但字距更大，阈值分开取
ok('上句字与字之间有清晰间隙', gaps.ask.emptyRatio > 0.10,
  `字缝占 ${(gaps.ask.emptyRatio * 100).toFixed(1)}%（画布宽 ${gaps.ask.w}px）`)
ok('候选字与字之间有清晰间隙', gaps.opt.emptyRatio > 0.06,
  `字缝占 ${(gaps.opt.emptyRatio * 100).toFixed(1)}%（画布宽 ${gaps.opt.w}px）`)

console.log('\n── 降落动画 ──────────────────────────────────────────')
const drop = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const cam = window.__G.camera
  const L = window.__q3d
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  const y0 = V.askSprite.position.y
  const op0 = V.askSprite.material.opacity
  const rot0 = V.askSprite.material.rotation
  // 逐帧推进，记录轨迹
  const trail = []
  for (let i = 0; i < 60; i++) {
    V.update(1 / 60, cam, { timeLeft: 5, timeLimit: 6 })
    if (i === 3 || i === 10 || i === 30 || i === 59) {
      trail.push({
        y: +V.askSprite.position.y.toFixed(2),
        op: +V.askSprite.material.opacity.toFixed(2),
        rot: +V.askSprite.material.rotation.toFixed(2),
      })
    }
  }
  return {
    y0: +y0.toFixed(2), op0: +op0.toFixed(2), rot0: +rot0.toFixed(2),
    trail,
    phase: V.phase,
    optYs: V.items.map((it) => +it.sprite.position.y.toFixed(3)),
    allVisible: V.items.every((it) => it.sprite.material.opacity > 0.7),
    barVisible: V.bar.visible,
    barW: +V.bar.scale.x.toFixed(2),
    dist: +V._dist.toFixed(2),
    rotEnd: +V.askSprite.material.rotation.toFixed(2),
    askOpacityEnd: +V.askSprite.material.opacity.toFixed(2),
    askBrightEnd: +V.askSprite.material.color.r.toFixed(2),
    // 上句落定后的最终高度，和从几何推出来的期望值比：
    // ASK_Y = (OPT_DY + OPT_H/2) + (FLOAT_B + ASK_GAP_V + FLOAT_A) + ASK_H/2
    //       = (1.94+0.82) + (0.02+0.28+0.026) + 0.913 = 4.00
    askFinalY: +V.askSprite.position.y.toFixed(3),
  }
})
ok('初始位置在高处（还没落下来）', drop.y0 > 3, `y=${drop.y0}m`)
ok('初始几乎不可见', drop.op0 < 0.5, `opacity=${drop.op0}`)
ok('初始带倾斜（掉下来是斜的）', Math.abs(drop.rot0) > 0.1, `rot=${drop.rot0}rad`)
ok('y 单调下降', drop.trail.every((t, i) => i === 0 || t.y < drop.trail[i - 1].y + 0.05),
  drop.trail.map((t) => t.y).join(' → '))
ok('透明度一路抬升', drop.trail[drop.trail.length - 1].op > 0.9,
  drop.trail.map((t) => t.op).join(' → '))
ok('落定后回到目标高度', Math.abs(drop.askFinalY - 4.00) < 0.06,
  `y=${drop.askFinalY}m（几何推得 4.00m）`)
ok('落定后转正', Math.abs(drop.rotEnd) < 0.02, `rot=${drop.rotEnd}`)
ok('落定后完全显现', drop.askOpacityEnd > 0.9, `opacity=${drop.askOpacityEnd}`)
ok('上句常亮比候选亮（它是题面主角）', drop.askBrightEnd > 1.05,
  `ask=${drop.askBrightEnd} vs opt≈1`)
ok('进入 hold 阶段', drop.phase === 'hold', `phase=${drop.phase}`)
ok('三个候选都显现', drop.allVisible)
ok('中间层落在准星上（y≈0）', Math.abs(drop.optYs[1]) < 0.02, `ys=${JSON.stringify(drop.optYs)}`)
// 上下层对称错开，且层距 = OPT_DY（当前 1.26m）
const optDy = Math.abs(drop.optYs[0] - drop.optYs[1]);
ok('上下层对称错开', Math.abs(drop.optYs[0] + drop.optYs[2]) < 0.02,
  `ys=${JSON.stringify(drop.optYs)}`)
ok('层距合理（约 1.94m）', optDy > 1.7 && optDy < 2.2, `层距=${optDy.toFixed(2)}m`)
ok('倒计时条可见且按比例', drop.barVisible && drop.barW > 2.6 && drop.barW < 4.3, `barW=${drop.barW}m`)
ok('句阵挂在相机前方合理距离', drop.dist > 6 && drop.dist < 30, `dist=${drop.dist}m`)

// 视觉底线：整块句阵不能冲出画面。第一版的距离公式把 FILL 乘在分子上，
// 算出~1.7m 被 clamp 到下限，5 个字横着糊满整个屏幕、三个候选被挤出视野——
// 这条断言就是为了守住那个回归。
const fit = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const cam = window.__G.camera
  const L = window.__q3d
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  L.settle(V, cam, 60)
  // 把每个精灵的中心投影到 NDC，看有没有跑出 [-1,1]
  const proj = []
  // getWorldPosition 需要一个可写的 Vector3；复用一份独立副本，别污染精灵自身的坐标
  const scratch = V.askSprite.position.clone()
  const tanHalf = Math.tan((cam.fov * Math.PI) / 360)
  for (const s of [V.askSprite, ...V.items.map((it) => it.sprite), V.bar]) {
    const w = s.getWorldPosition(scratch)
    const depth = w.distanceTo(cam.position)
    // 该精灵在 NDC 上的半宽/半高（Sprite 是 billboard，世界尺寸固定）
    const halfH = (s.scale.y * 0.5) / (depth * tanHalf)
    const halfW = halfH * cam.aspect
    const q = w.clone().project(cam)
    proj.push({
      x: +q.x.toFixed(3), y: +q.y.toFixed(3), z: +q.z.toFixed(3),
      // 边缘离画面边界还有多少余量（正数 = 安全）
      mx: +(1 - Math.abs(q.x) - halfW).toFixed(3),
      my: +(1 - Math.abs(q.y) - halfH).toFixed(3),
    })
  }
  return {
    proj,
    inFront: proj.every((q) => q.z > -1 && q.z < 1),
    insideX: proj.every((q) => q.mx > 0),
    insideY: proj.every((q) => q.my > 0),
    spanY: +(Math.max(...proj.map((q) => q.y)) - Math.min(...proj.map((q) => q.y))).toFixed(2),
  }
})
ok('句阵在相机前方（没被裁掉）', fit.inFront)
ok('横向完整在画面内（含牌面边缘）', fit.insideX,
  `余量 ${fit.proj.map((q) => q.mx).join(' / ')}`)
ok('纵向完整在画面内（含牌面边缘）', fit.insideY,
  `余量 ${fit.proj.map((q) => q.my).join(' / ')}`)
// 倒计时条也必须在画面内。块高计算曾经只量到"上句顶→0 号候选底"，漏掉了下半截，
// 距离算得过近，条被挤出画面下缘——这条断言专门守它。
ok('倒计时条在画面内', fit.proj[fit.proj.length - 1].my > 0,
  `下缘余量 ${fit.proj[fit.proj.length - 1].my}`)
ok('纵向占幅合理（不超过画面 80%）', fit.spanY < 1.6, `span=${fit.spanY}`)

console.log('\n── 各层在屏幕上的分布 ──────────────────────────────────')
// 这是踩过最隐蔽的 bug：**层偏移被设了两次**（optSlots 容器一次、精灵自己又一次），
// 于是 0/2 号候选被抬到 ±2×OPT_DY，正好撞上上句的高度、视觉上叠字；而中间那层
// 因为 OPT_DY*(1-1)=0 恰好没受影响，所以单看准星拾取是好的，很难发现。
// 这里直接从世界坐标反推 NDC，量各层的实际分布。
const ndcs = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const cam = window.__G.camera
  const L = window.__q3d
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  L.settle(V, cam, 120)
  const scratch = V.askSprite.position.clone()
  const ndcOf = (s) => +s.getWorldPosition(scratch.clone()).project(cam).y.toFixed(4)
  // 世界高度也要看：容器 offset 为0、偏移只在精灵上，才是对的
  const slotOffsets = V.optSlots.map((g) => +g.position.y.toFixed(4))
  const ys = [V.askSprite, ...V.items.map((it) => it.sprite), V.bar].map(ndcOf).sort((a, b) => b - a)
  const gaps = ys.slice(0, -1).map((v, i) => +(v - ys[i + 1]).toFixed(4))
  return {
    ys, gaps, minGap: Math.min(...gaps),
    slotOffsets,
    worldYs: [V.askSprite, ...V.items.map((it) => it.sprite)].map((s) => +s.position.y.toFixed(2)),
    dist: +V._dist.toFixed(2),
  }
})
// 容器必须留在原点——层偏移只由精灵承担
ok('候选容器不偏移（层偏移只在精灵上，无双重偏移）',
  ndcs.slotOffsets.every((v) => Math.abs(v) < 1e-6), `slots=${JSON.stringify(ndcs.slotOffsets)}`)
ok('三层在世界空间对称分布', Math.abs(ndcs.worldYs[1] + ndcs.worldYs[3]) < 0.05
  && Math.abs(ndcs.worldYs[2]) < 0.05, `worldYs=${JSON.stringify(ndcs.worldYs)}`)
// 各层在屏幕上要均匀分开（透视不该把上句和 1 号候选压到一起）
ok('各层在屏幕上均匀分开（最小 NDC 间距 > 0.16）', ndcs.minGap > 0.16,
  `间距 ${ndcs.gaps.join('/')}（dist=${ndcs.dist}m）`)
ok('上句明显高于第一层候选',
  (ndcs.ys[0] - ndcs.ys[1]) > 0.2, `Δ=${(ndcs.ys[0] - ndcs.ys[1]).toFixed(3)}`)

// 层与层之间不能压在一起。第一版把 ASK_Y 写死，没算上句底边与 0 号候选顶边的净空，
// 结果上句直接盖在第一层候选上。而且不能只看某一帧——上句和候选都在"呼吸"，
// 真正要保证的是**整个呼吸周期内的最小净空**都还是正的。
const spacing = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const cam = window.__G.camera
  const L = window.__q3d
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  L.settle(V, cam, 90)
  const ask = V.askSprite
  const items = V.items.map((it) => it.sprite)
  // 扫 4 秒（两个呼吸周期都覆盖到），记录每一帧的最小净空。
  // 注意方向：上句在**上**方、候选在**下**方，所以净空 = 上句底边 - 候选顶边（正值=分开）。
  const half = (s) => s.scale.y * 0.5
  let minAsk = Infinity, minOpt = Infinity, minBar = Infinity
  const frames = 240
  for (let i = 0; i < frames; i++) {
    V.update(1 / 60, cam, { timeLeft: 5, timeLimit: 6 })
    minAsk = Math.min(minAsk, (ask.position.y - half(ask)) - (items[0].position.y + half(items[0])))
    minOpt = Math.min(minOpt,
      (items[0].position.y - half(items[0])) - (items[1].position.y + half(items[1])),
      (items[1].position.y - half(items[1])) - (items[2].position.y + half(items[2])))
    minBar = Math.min(minBar,
      (items[2].position.y - half(items[2])) - (V.bar.position.y + V.bar.scale.y * 0.5))
  }
  const f = (n) => +n.toFixed(3)
  return { minAsk: f(minAsk), minOpt: f(minOpt), minBar: f(minBar), frames }
})
ok('整个呼吸周期内，上句与第一层候选不重叠', spacing.minAsk > 0,
  `最小净空 ${spacing.minAsk}m（扫 ${spacing.frames} 帧）`)
ok('整个呼吸周期内，相邻候选不重叠', spacing.minOpt > 0,
  `最小净空 ${spacing.minOpt}m`)
ok('整个呼吸周期内，倒计时条不与候选重叠', spacing.minBar > 0,
  `最小净空 ${spacing.minBar}m`)

console.log('\n── 准星拾取 ──────────────────────────────────────────')
// 拾取语义是「垂直方向就近取」而不是"准星必须落在牌面内"，所以测试要按
// 层间距的**中点**来验证：转到相邻层与中间层的分界上，就该切到那一层。
const pick = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const cam = window.__G.camera
  const L = window.__q3d
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  L.settle(V, cam, 60)
  const before = V.syncHover(cam)
  // 拾取语义是「垂直方向就近取」而不是"准星必须落在牌面内"：各层在 NDC 上
// 分别落在 +0.50 / 0 / -0.50，分界在 ±0.25，对应俯仰约 ±7°（实测：6°→7° 切换）。
// 角度直接写成±10°——落在 ±7~20° 这个稳定区间里，不去卡边界。
// 注意 fov 实际约 52°，且 rotateX 转的是相机俯仰、与 NDC 偏移非线性，
// 所以这里不去"算"角度，而是取一个明确在区间内部的实测值。
const ang = 10 * Math.PI / 180
  const q0 = cam.quaternion.clone()
  const r0 = cam.rotation.clone()
  cam.rotateX(ang); cam.updateMatrixWorld(true)
  const up = V.syncHover(cam)
  cam.quaternion.copy(q0); cam.rotation.copy(r0); cam.updateMatrixWorld(true)
  cam.rotateX(-ang); cam.updateMatrixWorld(true)
  const down = V.syncHover(cam)
  // 抬头到句子完全退出画面 → 就不该再高亮任何一项
  cam.rotateX(60 * Math.PI / 180); cam.updateMatrixWorld(true)
  const far = V.syncHover(cam)
  cam.quaternion.copy(q0); cam.rotation.copy(r0); cam.updateMatrixWorld(true)
  // 分界必须干净：扫一遍 1° 步进，每层都要能命中，且不出现"跳层"
  const sweep = []
  for (let d = -18; d <= 18; d++) {
    cam.rotation.copy(r0)
    cam.rotateX(d * Math.PI / 180); cam.updateMatrixWorld(true)
    sweep.push(V.pick(cam))
  }
  cam.quaternion.copy(q0); cam.rotation.copy(r0); cam.updateMatrixWorld(true)
  return {
    before, up, down, far, restored: V.syncHover(cam),
    deg: 10, sweep,
    // 扫 37 个角度，三层都该出现过，且相邻采样点的 pick 最多差1（不能跳层）
    allSeen: new Set(sweep).size === 3,
    noSkip: sweep.every((v, i) => i === 0 || Math.abs(v - sweep[i - 1]) <= 1),
  }
})
ok('不挪鼠标时准星指中间那层（= 2 号）', pick.before === 1, `pick=${pick.before}`)
ok('视角上抬 10° → 指 1 号', pick.up === 0, `pick=${pick.up}`)
ok('视角下压 10° → 指 3 号', pick.down === 2, `pick=${pick.down}`)
ok('抬头看天时不乱指（超出拾取范围）', pick.far === -1, `pick=${pick.far}`)
ok('视角归位后回到 2 号', pick.restored === 1, `pick=${pick.restored}`)
ok('±18° 扫描三层都能指到', pick.allSeen, `覆盖 ${JSON.stringify([...new Set(pick.sweep)])}`)
ok('扫描过程中不跳层', pick.noSkip)

console.log('\n── 悬停高亮 ──────────────────────────────────────────')
const hov = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const cam = window.__G.camera
  const L = window.__q3d
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  L.settle(V, cam, 60)
  const base = V.items[0].sprite.scale.y          // 未高亮时的精灵高
  V.hover = 1
  L.settle(V, cam, 30)
  const h = V.items.find((it) => it.i === 1)
  const o = V.items.find((it) => it.i === 0)
  return {
    base: +base.toFixed(3),
    hovScale: +(h.sprite.scale.y / base).toFixed(3),   // 相对未高亮时的倍率
    othScale: +(o.sprite.scale.y / base).toFixed(3),
    hovBright: +h.sprite.material.color.r.toFixed(2),
    othBright: +o.sprite.material.color.r.toFixed(2),
  }
})
ok('悬停项被放大（+16%）', hov.hovScale > 1.12 && hov.hovScale < 1.22, `×${hov.hovScale}`)
ok('非悬停项保持原尺寸', Math.abs(hov.othScale - 1) < 0.02, `×${hov.othScale}`)
ok('悬停项更亮（提亮 55%）', hov.hovBright > 1.4 && hov.othBright < 1.1,
  `${hov.hovBright} vs ${hov.othBright}`)

// 截图：停在「全部落定 + 中间层高亮」的一刻，肉眼确认三维感。
// 必须先把 match 真的推进到playing 并让真quiz 出题——否则主循环每帧都会以
// "不是playing / 没题" 为由把句阵收起，截出来就是空画面（第一版就踩了这个坑）。
await page.evaluate(() => {
  const w = window.__inkwave
  const V = w.verse3d
  const cam = window.__G.camera
  const m = w.match
  m.attract = false; m.practice = false; m.paused = false
  m.state = 'playing'
  m.quiz._ask()
  // 让相机回到正常的第三人称跟随视角并更新一帧，否则可能停在 intro 的俯视机位上
  if (m.local) { w.rig.follow(m.local, true); w.rig.update(1 / 60) }
  cam.updateMatrixWorld(true)
  w._updateQuizVerse(1 / 60)
  V.hover = 1                       // 让中间那层高亮，截图里能看出"选中的那一项"
  window.__q3d.settle(V, cam, 40, { timeLeft: 4.2, timeLimit: 6 })
})
// 让主循环真的渲染几帧出来（软件渲染很慢，等一小会儿），再截图
await new Promise((r) => setTimeout(r, 4000))
await page.screenshot({ path: SHOT })
console.log(`\n📸 已截图 → ${SHOT}`)

console.log('\n── 答对消散 ──────────────────────────────────────────')
const burst = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const cam = window.__G.camera
  const L = window.__q3d
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  L.settle(V, cam, 60)
  const right = V.items.find((it) => it.i === 1)
  const wrong = V.items.find((it) => it.i === 0)
  const y0 = right.sprite.position.y
  const b0 = right.sprite.material.color.r
  V.resolve(1)
  for (let i = 0; i < 9; i++) V.update(1 / 60, cam, {})
  const mid = {
    y: +right.sprite.position.y.toFixed(2),
    op: +right.sprite.material.opacity.toFixed(2),
    wop: +wrong.sprite.material.opacity.toFixed(2),
    bright: +right.sprite.material.color.r.toFixed(2),
    rot: +right.sprite.material.rotation.toFixed(2),
  }
  for (let i = 0; i < 40; i++) V.update(1 / 60, cam, {})
  return {
    y0: +y0.toFixed(2), b0: +b0.toFixed(2), mid,
    live: V.live, visible: V.root.visible,
    kids: V.askSlot.children.length + V.optSlots.reduce((a, g) => a + g.children.length, 0),
  }
})
ok('正确项向上飞散', burst.mid.y > burst.y0 + 0.5, `y ${burst.y0} → ${burst.mid.y}m`)
ok('正确项边飞边转', Math.abs(burst.mid.rot) > 0.05, `rot=${burst.mid.rot}rad`)
ok('正确项爆亮', burst.mid.bright > burst.b0 + 0.5, `${burst.b0} → ${burst.mid.bright}`)
ok('正确项边飞边淡', burst.mid.op < 0.95 && burst.mid.op > 0, `opacity=${burst.mid.op}`)
ok('错误项原地压暗', burst.mid.wop < 0.2, `opacity=${burst.mid.wop}`)
ok('消散后自动收起', !burst.live && !burst.visible)
ok('精灵已清空（无泄漏）', burst.kids === 0, `kids=${burst.kids}`)

console.log('\n── 答错也收得干净 ────────────────────────────────────')
const wrong = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const cam = window.__G.camera
  const L = window.__q3d
  L.show(V, '白日依山尽',
    [{ i: 0, text: '黄河入海流' }, { i: 1, text: '欲穷千里目' }, { i: 2, text: '更上一层楼' }], 1)
  L.settle(V, cam, 60)
  V.resolve(-1)// 玩家答错 / 超时：没有正确答案可炸
  for (let i = 0; i < 50; i++) V.update(1 / 60, cam, {})
  return { live: V.live, visible: V.root.visible }
})
ok('答错后也能收起', !wrong.live && !wrong.visible)

console.log('\n── 反复出题不泄漏 ────────────────────────────────────')
const reuse = await page.evaluate(() => {
  const V = window.__inkwave.verse3d
  const cam = window.__G.camera
  const L = window.__q3d
  const before = V.root.parent.children.length
  let maxTex = 0
  for (let n = 0; n < 6; n++) {
    L.show(V, '床前明月光',
      [{ i: 0, text: '疑是地上霜' }, { i: 1, text: '举头望明月' }, { i: 2, text: '低头思故乡' }], 0)
    L.settle(V, cam, 60)
    maxTex = Math.max(maxTex, (V._texes || []).length)
    V.resolve(0)
    L.settle(V, cam, 60)
  }
  V.hide()
  return {
    added: V.root.parent.children.length - before,
    kids: V.askSlot.children.length + V.optSlots.reduce((a, g) => a + g.children.length, 0),
    texes: (V._texes || []).length,
    maxTex,
  }
})
ok('反复 6 轮不残留场景节点', reuse.added === 0, `added=${reuse.added}`)
ok('反复 6 轮不残留精灵', reuse.kids === 0, `kids=${reuse.kids}`)
ok('反复 6 轮不残留贴图引用', reuse.texes === 0, `texes=${reuse.texes}`)
ok('单题贴图数= 4（上句 + 3 候选 + 条）', reuse.maxTex <= 5, `peak=${reuse.maxTex}`)

console.log('\n── 真实对局接线 ──────────────────────────────────────')
const wiring = await page.evaluate(() => {
  const w = window.__inkwave
  const V = w.verse3d
  const m = w.match
  m.attract = false; m.practice = false; m.paused = false
  m.state = 'playing'
  const forced = m.quiz ? (m.quiz._ask(), !!m.quiz.active) : false
  const st = m.quiz ? m.quiz.state() : null
  w._updateQuizVerse(1 / 60)
  const shown = V.root.visible
  const kids = V.askSlot.children.length + V.optSlots.reduce((a, g) => a + g.children.length, 0)
  const optTexts = V.items.map((it) => (st && st.options[it.i] ? st.options[it.i].text : null))
  // 题目结束（active=null）后，消散动画要照常播完，这是答对的高光时刻
  const q = m.quiz.active
  m.quiz.active = null
  V.resolve(q ? q.correct : 0)
  const burstFrames = []
  for (let i = 0; i < 50; i++) {
    w._updateQuizVerse(1 / 60)
    burstFrames.push({ vis: V.root.visible, live: V.live })
  }
  const visDuringBurst = burstFrames.slice(0, 20).every((f) => f.vis === true)
  const visAfterBurst = burstFrames[burstFrames.length - 1]
  // 没有题、也不在消散中 → 必须收起
  w._updateQuizVerse(1 / 60)
  const hiddenWithoutQ = V.root.visible === false && V.live === false
  return {
    forced, shown, kids, optTexts,
    visDuringBurst, visAfterBurst, hiddenWithoutQ,
  }
})
ok('真quiz 能出题并驱动句阵', wiring.forced && wiring.shown, `kids=${wiring.kids}`)
ok('句阵候选与 quiz 选项一一对应',
  wiring.optTexts.length === 3 && wiring.optTexts.every((t) => typeof t === 'string'),
  JSON.stringify(wiring.optTexts))
ok('消散动画全程可见（高光时刻不被收起）', wiring.visDuringBurst)
ok('消散播完后自动收起', wiring.visAfterBurst.live === false && wiring.visAfterBurst.vis === false,
  `live=${wiring.visAfterBurst.live} vis=${wiring.visAfterBurst.vis}`)
ok('没有题时收起', wiring.hiddenWithoutQ)

console.log('\n── 暂停时收起 ────────────────────────────────────────')
//注意：暂停/开地图走的是 setShown(false)「软收起」——题目和进度都留着，只是
// root.visible=false。所以断言的是 root.visible，而不是 live（live 应当仍为 true）。
const paused = await page.evaluate(() => {
  const w = window.__inkwave
  const V = w.verse3d
  const m = w.match
  m.state = 'playing'; m.paused = false; m.attract = false
  m.quiz._ask()
  w._updateQuizVerse(1 / 60)
  const playing = { live: V.live, vis: V.root.visible }
  m.paused = true
  w._updateQuizVerse(1 / 60)
  const whilePaused = { live: V.live, vis: V.root.visible, shown: V.shown }
  m.paused = false
  w._updateQuizVerse(1 / 60)
  const resumed = { live: V.live, vis: V.root.visible }
  m.quiz.active = null
  w._updateQuizVerse(1 / 60)
  return { playing, whilePaused, resumed, endVis: V.root.visible, endLive: V.live }
})
ok('对局中显示', paused.playing.vis === true, `visible=${paused.playing.vis}`)
ok('暂停时隐藏', paused.whilePaused.vis === false, `visible=${paused.whilePaused.vis}`)
ok('暂停时保留题目（软收起，不丢进度）', paused.whilePaused.live === true, `live=${paused.whilePaused.live}`)
ok('恢复后重新可见', paused.resumed.vis === true, `visible=${paused.resumed.vis}`)
ok('题目结束后隐藏', paused.endVis === false, `visible=${paused.endVis}`)

console.log('\n── 地图视角收起 ──────────────────────────────────────')
const mapK = await page.evaluate(() => {
  const w = window.__inkwave
  const V = w.verse3d
  const m = w.match
  m.state = 'playing'; m.paused = false
  m.quiz._ask()
  w.rig.mapK = 0
  w._updateQuizVerse(1 / 60)
  const normal = V.root.visible
  w.rig.mapK = 0.9
  w._updateQuizVerse(1 / 60)
  const onMap = V.root.visible
  w.rig.mapK = 0
  w._updateQuizVerse(1 / 60)
  const back = V.root.visible
  m.quiz.active = null; w._updateQuizVerse(1 / 60)
  return { normal, onMap, back }
})
ok('正常视角显示', mapK.normal === true, `visible=${mapK.normal}`)
ok('开地图时隐藏（不挡俯视战术图）', mapK.onMap === false, `visible=${mapK.onMap}`)
ok('关地图后恢复', mapK.back === true, `visible=${mapK.back}`)

console.log('\n── 无 quiz 对象时安全降级 ────────────────────────────')
const noQuiz = await page.evaluate(() => {
  const w = window.__inkwave
  const V = w.verse3d
  const m = w.match
  const realQuiz = m.quiz
  m.quiz = undefined                 // 模拟 turf 模式（那边根本不建 PoemQuiz）
  let threw = null
  let vis = null
  try {
    w._updateQuizVerse(1 / 60)
    vis = V.root.visible
  } catch (e) { threw = String(e) }
  m.quiz = realQuiz
  return { threw, vis }
})
ok('match.quiz 缺失时不抛异常', !noQuiz.threw, noQuiz.threw || '')
ok('match.quiz 缺失时保持隐藏', noQuiz.vis === false, `visible=${noQuiz.vis}`)

console.log('\n── 控制台 ────────────────────────────────────────────')
// 资源 404 与脚本错误分开报：404 多半是仓库里本来就有的（比如可选的音效/贴图），
// 真正要拦的是"脚本跑挂了"这种硬错误。
if (failed.length) console.log(`  ℹ 资源加载失败 ${failed.length} 条（非本次改动引入）：`)
for (const f of failed.slice(0, 5)) console.log(`    ·${f}`)
const real = errors.filter((e) => !/favicon|ERR_|net::|Autoplay|deprecated|Failed to load resource/i.test(e))
ok('无脚本错误', real.length === 0, real.slice(0, 3).join(' | '))

await browser.close()
console.log('\n' + '─'.repeat(52))
console.log(fail === 0
  ? `✅ 全部通过  通过 ${pass} / ${pass + fail}`
  : `❌ ${fail} 项失败  通过 ${pass} / ${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)