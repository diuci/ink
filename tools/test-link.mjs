// 联句机制验证：证明 2.0× 倍率现在真的能触发。
//
// 这是对 Phase 1 发现的六个缺陷的回归测试。原先 `line`恒为 0 且
// `canLink` 只查 `Math.abs(i - j) === 1`，导致联句倍率从未生效。
//
// 用法：node tools/test-link.mjs
import { poemById, POEMS } from '../src/game/poems/poems.js'
import { canLink, judgePair, POEM_SCORE, assignPoems } from '../src/game/poems/assign.js'

let pass = 0, fail = 0
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log('  ✓ %s %s', msg, extra) }
  else { fail++; console.log('  ✗ %s %s', msg, extra) }
}
const section = (t) => console.log('\n── %s %s', t, '─'.repeat(Math.max(0, 46 - t.length)))

// ---------------------------------------------------------------- 1
section('canLink 查 pairs，不再用 abs(i-j)===1')

const chunxiao = poemById('chunxiao')
ok(!!chunxiao, '取到《春晓》')
ok(chunxiao.pairs.length > 0, '《春晓》有 pairs', JSON.stringify(chunxiao.pairs))
ok(canLink(chunxiao, 0, chunxiao, 1) === true, '《春晓》第1⇄第2句 → 联句')
ok(canLink(chunxiao, 1, chunxiao, 0) === true, '顺序颠倒也算联句（无向）')
ok(canLink(chunxiao, 0, chunxiao, 0) === false, '同一句与自己不构成联句')

// 内容仓已把半句合并为整句，《敕勒歌》现在是 4 个整句、pairs 为 [[0,1],[2,3]]：
//   [0] 敕勒川，阴山下。   [1] 天似穹庐，笼盖四野。
//   [2] 天苍苍，野茫茫。   [3] 风吹草低见牛羊。
// 这与旧版「7 行半句 + pairs [[0,1],[4,5]]」是同一联句关系，只是下标变了。
const chilege = poemById('chilege')
ok(!!chilege, '取到《敕勒歌》')
if (chilege) {
  ok(chilege.lines.length === 4, '《敕勒歌》合并为 4 个整句',
    `  实际 ${chilege.lines.length} 句`)
  ok(JSON.stringify(chilege.pairs) === '[[0,1],[2,3]]',
    'pairs 为 [[0,1],[2,3]]（整句口径）', `  实际 ${JSON.stringify(chilege.pairs)}`)
  ok(canLink(chilege, 0, chilege, 1) === true, '「敕勒川，阴山下」⇄「天似穹庐…」算联句')
  ok(canLink(chilege, 2, chilege, 3) === true, '「天苍苍，野茫茫」⇄「风吹草低…」算联句')
  ok(canLink(chilege, 1, chilege, 2) === false, '跨联的两句不算联句')
}

// 无 pairs 的篇目（单句名句）不应成立
const single = POEMS.find((p) => !p.pairs.length)
ok(!!single, '存在无 pairs 的篇目', single ? `  ${single.title}` : '')
if (single) ok(canLink(single, 0, single, 0) === false, '无 pairs 的篇目不构成联句')

// ---------------------------------------------------------------- 2
section('judgePair 返回 link（这是 2.0× 的判定入口）')

const a = { poemId: 'chunxiao', line: 0 }
const b = { poemId: 'chunxiao', line: 1 }
const r = judgePair(a, b)
ok(r.kind === 'link', '同诗相邻两句 → link', JSON.stringify(r))
ok(r.kind === 'link' && POEM_SCORE[r.kind] === 2.0,
  'link 的收益倍率是 2.0×', `  POEM_SCORE.link = ${POEM_SCORE.link}`)

const mis = judgePair({ poemId: 'chunxiao', line: 0 }, { poemId: 'jingyesi', line: 0 })
ok(mis.kind === 'mismatch', '不同诗 → mismatch', JSON.stringify(mis))
ok(POEM_SCORE.mismatch < 1.0, 'mismatch 倍率小于 1（惩罚）',
  `  ${POEM_SCORE.mismatch}`)

const none = judgePair(null, b)
ok(none.kind === 'none', '缺句→ none（不判定）')

// ---------------------------------------------------------------- 3
section('pairs 索引合法性（全部篇目）')

let bad = []
for (const p of POEMS) {
  for (const [x, y] of p.pairs) {
    if (!(x >= 0 && x < p.lines.length) || !(y >= 0 && y < p.lines.length)) {
      bad.push(`${p.title} pairs [${x},${y}] 越界（共 ${p.lines.length} 句）`)
    }
  }
  if (p.pairs.some(([x, y]) => x === y)) bad.push(`${p.title} pairs 含自配`)
}
ok(bad.length === 0, `${POEMS.length} 篇的 pairs 索引全部合法`, bad.slice(0, 3).join('; '))

const linkable = POEMS.filter((p) => p.pairs.length > 0)
ok(linkable.length >= POEMS.length - 1,
  `${linkable.length} / ${POEMS.length} 篇可联句`)

// ---------------------------------------------------------------- 4
section('assignPoems 按年级取池')

for (const g of [1, 5, 7, 10, 12]) {
  const picks = assignPoems(['shooter', 'roller', 'blade'], g)
  ok(picks.length === 3 && picks.every(Boolean),
    `年级 ${g} 能分配 3 首`, `  ${picks.map((p) => p.title).join('、')}`)
  const dup = new Set(picks.map((p) => p.id))
  ok(dup.size === picks.length, `  年级 ${g} 同队不撞诗`)
}

// ---------------------------------------------------------------- 5
section('倍率梯度（设计意图）')

ok(POEM_SCORE.link > POEM_SCORE.solo,
  '联句 > 独涂', `${POEM_SCORE.link} > ${POEM_SCORE.solo}`)
ok(POEM_SCORE.solo > POEM_SCORE.mismatch,
  '独涂 > 搭错', `${POEM_SCORE.solo} > ${POEM_SCORE.mismatch}`)
ok(POEM_SCORE.link / POEM_SCORE.solo === 2,
  '联句恰好是独涂的 2 倍', `  ${POEM_SCORE.link / POEM_SCORE.solo}×`)

// ---------------------------------------------------------------- 汇总
console.log('\n' + '─'.repeat(52))
console.log('%s  通过 %d / %d', fail === 0 ? '✅ 全部通过' : '❌ 有失败', pass, pass + fail)
process.exit(fail === 0 ? 0 : 1)
