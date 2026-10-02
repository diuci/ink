// 一次性校验：WEAPON_POEM 的 poemId 是否都存在于内容仓快照里。
// 用法：node tools/check-weapon-poems.mjs
import { readFileSync } from 'node:fs'
import { POEMS } from '../src/game/poems/poems.js'

const src = readFileSync(new URL('../src/game/poems/assign.js', import.meta.url), 'utf8')
const m = src.match(/WEAPON_POEM = \{([\s\S]*?)\n\};/)
const pairs = [...m[1].matchAll(/(\w+):\s*'([\w-]+)'/g)].map(([, w, p]) => ({ w, p }))

const ids = new Set(POEMS.map((p) => p.id))
const miss = pairs.filter(({ p }) => !ids.has(p))

console.log('诗库总数：%d', POEMS.length)
console.log('武器映射：%d 条', pairs.length)
if (miss.length) {
  console.log('\n❌ 缺失 %d 条：', miss.length)
  for (const { w, p } of miss) console.log('   %s → %s', w, p)
} else {
  console.log('\n✅ 全部武器映射都能在诗库中找到')
}

//顺带查：可联句的篇目数
const linkable = POEMS.filter((p) => p.pairs.length > 0)
console.log('\n有联句配对的篇目：%d / %d', linkable.length, POEMS.length)
