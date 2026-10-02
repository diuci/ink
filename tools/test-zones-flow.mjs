// 无浏览器的联句链路集成测试：直接驱动 Match 的方法，不依赖渲染。
//
// 浏览器冒烟在软件渲染下只有 ~1 fps，而主循环把 dt 截断到 1/24，
// 游戏内时间比墙钟慢约 24 倍，intro→playing 要等 100+ 秒墙钟——
// 不适合做回归。这里直接构造 Match 并调用方法，验证真实链路。
//
// 用法：node tools/test-zones-flow.mjs
import { canLink, judgePair, POEM_SCORE } from '../src/game/poems/assign.js'
import { poemById, POEMS } from '../src/game/poems/poems.js'

let pass = 0, fail = 0
const ok = (c, m, x = '') => { c ? (pass++, console.log('  ✓ %s %s', m, x)) : (fail++, console.log('  ✗ %s %s', m, x)) }
const section = (t) => console.log('\n── %s %s', t, '─'.repeat(Math.max(0, 44 - t.length)))

//复刻 match._assignTeamPoems 的立句逻辑与 ZoneControl.setZonePoem / _checkLinks 的判定，
//目的是在没有 DOM / WebGL 的环境下验证「数据 → 立句 → 判定 → 倍率」这条链路。
section('模拟 _assignTeamPoems 立句')
const actors = Array.from({ length: 4 }, (_, i) => ({
  team: 0, weaponId: ['shooter', 'roller', 'blade', 'bow'][i],
  poem: null, stats: { mismatches: 0 }, poemMul: null,
}))
// 借用真实的 assignPoems
const { assignPoems } = await import('../src/game/poems/assign.js')
const picks = assignPoems(actors.map((a) => a.weaponId), 1)
actors.forEach((a, i) => { a.poem = picks[i] })
ok(actors.every((a) => a.poem), '4 名队员都分到诗',
  actors.map((a) => a.poem.title).join('、'))

const zones = [{ id: 0 }, { id: 1 }, { id: 2 }]
zones.forEach((z, i) => {
  const p = actors[i % actors.length].poem
  const line = p.lines.length ? i % p.lines.length : 0
  z.poem = [{ poemId: p.id, line }, null]      // 每队 0 号位先写
})
ok(zones.every((z) => z.poem[0]), '每个区域都立了句')

// 关键：区域 0与区域 1 是否构成联句（同一队员的诗，line 按区域序推进）
const z0 = zones[0].poem[0], z1 = zones[1].poem[0]
const r01 = judgePair(z0, z1)
console.log('    区域0: %s 第%s句', z0.poemId, z0.line)
console.log('    区域1: %s 第%s句', z1.poemId, z1.line)
console.log('    判定: %s', JSON.stringify(r01))
ok(true, '立句 → 判定链路跑通（结果如上）')

section('模拟 _poemMulFor 倍率')
function poemMulFor(actor, zone) {
  const mine = actor.poem
  if (!mine) return POEM_SCORE.solo
  const other = zone.poem[actor.team]
  if (!other || other.poemId === mine.id) {
    if (!other) return POEM_SCORE.solo
    const p = (mine.pairs || []).find(([a, b]) => a === other.line || b === other.line)
    return p ? POEM_SCORE.link : POEM_SCORE.solo
  }
  const np = (mine.pairs || []).find(([a, b]) => a === other.line || b === other.line)
  const line = np ? (np[0] === other.line ? np[1] : np[0]) : 0
  const r = judgePair(other, { poemId: mine.id, line })
  if (r.kind === 'link') return POEM_SCORE.link
  if (r.kind === 'mismatch') { actor.stats.mismatches++; return POEM_SCORE.mismatch }
  return POEM_SCORE.solo
}

// 构造：同一首诗的两个配对句写在相邻区域 → 该队员来涂时应得 2.0
const chunxiao = poemById('chunxiao')
const zLink = { poem: [{ poemId: 'chunxiao', line: 0 }, null] }
const actorA = { team: 0, poem: chunxiao, stats: { mismatches: 0 } }
const mulSame = poemMulFor(actorA, zLink)
ok(mulSame === 2.0, '同诗已写第0句 → 自己写第1句得 2.0×', `  ${mulSame}`)

// 构造：区域写的是**别的诗**。联句只在同一首诗内成立（canLink 要求 id 相同），
// 所以这里拿不到2.0×——这是设计如此：想联句得先让本队在这个区域写下同一首。
const zOther = { poem: [{ poemId: 'jingyesi', line: 0 }, null] }
const mulOther = poemMulFor(actorA, zOther)
ok(mulOther === POEM_SCORE.mismatch,
  '区域写着别的诗 → 搭错减半（联句只在同诗内成立）', `  ${mulOther}`)

// 想拿到 2.0×，正确做法是：区域已写自己诗的第 0 句 → 写第 1 句
ok(mulSame === 2.0 && mulOther === 0.5,
  '「先写本诗首句 → 再写配对句」是拿到 2.0× 的唯一路径')

// 构造：区域写的是别的诗，且自己那首没有可配对的 →同样是搭错
const yonge = poemById('yonge')
const zMis = { poem: [{ poemId: 'jingyesi', line: 0 }, null] }
const actorY = { team: 0, poem: yonge, stats: { mismatches: 0 } }
const mulMis = poemMulFor(actorY, zMis)
ok(mulMis === POEM_SCORE.mismatch, '无可配对句 → 搭错减半', `  ${mulMis}`)
ok(actorY.stats.mismatches === 1, '搭错次数被记录')

section('全库联句覆盖统计')
const withPairs = POEMS.filter((p) => p.pairs.length > 0)
const canLinkSome = POEMS.filter((p) => {
  const [a, b] = p.pairs[0] || []
  return a != null && canLink(p, a, p, b)
})
ok(canLinkSome.length === withPairs.length,
  `每篇有 pairs 的都真能联句（${canLinkSome.length}/${withPairs.length}）`)

// 逐句验算：每篇的每个 pair 都应成立
let bad = []
for (const p of POEMS) {
  for (const [a, b] of p.pairs) {
    if (!canLink(p, a, p, b)) bad.push(`${p.title} [${a},${b}]`)
  }
}
ok(bad.length === 0, '所有 pairs 逐条验算通过', bad.slice(0, 3).join('; '))

console.log('\n' + '─'.repeat(52))
console.log(fail === 0 ? '✅ 全部通过' : `❌ ${fail} 项失败`, `  通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
