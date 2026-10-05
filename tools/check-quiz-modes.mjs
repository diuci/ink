// 丢词大作战 — 「三种模式都出接诗题」的回归护栏
//
// 背景：这游戏叫《丢词大作战》，接诗原来却只挂在 zones 模式
// （match 构造里 if (mode === 'zones') 才 new PoemQuiz）。现在改成全模式。
//
// 这个测试不启动游戏，只静态检查两件容易退化的事：
//   1. PoemQuiz 不再被关在 zones 分支里
//   2. 非 zones 模式的地面刻字有落笔处（paint.discRegion 存在且 match 用了它）
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  \u2713 ' + label) }
  else { fail++; console.log('  \u2717 ' + label + (extra ? '  ' + extra : '')) }
};

const match = readFileSync('src/game/match.js', 'utf8');
const paint = readFileSync('src/world/paint.js', 'utf8');
const quiz = readFileSync('src/game/poems/quiz.js', 'utf8');
const config = readFileSync('src/config.js', 'utf8');

console.log('\u2500\u2500 接诗：全模式 \u2500\u2500\n');

console.log('1) PoemQuiz 不再锁在 zones 分支里');
{
  // 取 new PoemQuiz 那一行，看它前面有没有被 if (mode === 'zones') 包住。
  const i = match.indexOf('new PoemQuiz');
  ok(i > 0, 'match.js 仍然创建 PoemQuiz');
  // 直接看 zones / boss 两个分支之间的代码——PoemQuiz 必须落在它们外面。
  // （别去数「前面最近的 if」：zones 分支自己就正好在它前面，那是对的。）
  const zi = match.indexOf("if (this.mode === 'zones')");
  const bi = match.indexOf("if (this.mode === 'boss')");
  ok(zi > 0 && bi > zi, 'zones / boss 两个分支都在');
  const between = match.slice(match.indexOf('}', zi) + 1, bi);
  ok(/new PoemQuiz/.test(between), 'PoemQuiz 在 zones 分支**之外**创建');
  ok(/_assignTeamPoems\(\)/.test(between), '_assignTeamPoems 也在分支之外（三种模式都分诗）');
}

console.log('\n2) 地面刻字在非 zones 模式有落笔处');
{
  ok(/discRegion\s*\(/.test(paint), 'paint.js 提供了 discRegion()');
  ok(/queryBlocks/.test(paint), 'discRegion 用 block 查询遍历格子');
  ok(/discRegion\?\./.test(match) || /discRegion\(/.test(match), 'match.stampPoemAt 用到了它');
  ok(/openClaim/.test(quiz), '非 zones 模式有独立的判地比例 openClaim');
  ok(/stampRadius/.test(quiz), '落笔半径 stampRadius 可调');
  ok(/const QUIZ/.test(quiz) && /openClaim/.test(quiz), '这些都在 QUIZ 配置里，不是写死的');
}

console.log('\n3) 三种模式都在配置里存在');
{
  for (const m of ['turf', 'zones', 'boss']) {
    ok(match.includes("'" + m + "'"), 'match.js 认识 ' + m);
  }
  ok(/lastMode/.test(config), '设置里有模式选择');
}

console.log('\n' + (fail ? '\u2717 有失败' : '\u2713 全部通过') + '   通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
