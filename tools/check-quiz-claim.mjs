// 丢词大作战 — 接诗区域占领比例的回归测试
//
// 背景：答对接诗原本会把脚下整个区域判给本队（claim=1），而 zones 的占领线是
// 「覆盖 ≥ 80%」，所以答对一题就能白拿整个区域，接诗比涂地快太多。
// 现在接诗走 QUIZ.zoneClaim = 0.6，只判一部分格子。这个测试守住三件事：
//   1. 判的比例**精确**等于 zoneClaim（不多不少）
//   2. 挑中的格子是**确定的**（同一区域每次同一批，联机各端才一致）
//   3. 0.6 **不会**越过 80% 占领线（否则这次修复等于没做）
//   4. counts 计数与 grid 始终自洽
import { PaintSystem } from '../src/world/paint.js';
import { QUIZ } from '../src/game/poems/quiz.js';

const CAPTURE = 0.8;                 // zones.js 的占领线
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.log('  \u2717 ' + label + (extra ? '  ' + extra : '')); }
};

// 造一个只带 _claimRegion 所需字段的假 PaintSystem
function fakePaint(n, owned = 0) {
  return {
    paintFaces: new Int32Array(1),
    dead: null,
    grid: new Int8Array(n),          // 0=无主 1=甲 2=乙
    counts: [0, 0],
    version: 0,
  };
}
// 区域：n 个格子，格子号 0..n-1
const region = (n) => ({ cells: Array.from({ length: n }, (_, i) => i), polys: null });

const share = (p, team) => {
  const want = team === 0 ? 1 : 2;
  let c = 0;
  for (let i = 0; i < p.grid.length; i++) if (p.grid[i] === want) c++;
  return c / p.grid.length;
};

console.log('\u2500\u2500 接诗区域占领比例 \u2500\u2500\n');

console.log('1) claim=1 仍然整块判给本队（默认值行为不变）');
{
  const p = fakePaint(500);
  PaintSystem.prototype._claimRegion.call(p, region(500), 0, 1);
  ok(share(p, 0) === 1, 'claim=1 \u2192 100% 归属本队', 'got ' + share(p, 0));
  ok(p.counts[0] === 500, 'counts 同步为 500', 'got ' + p.counts[0]);
}

console.log('\n2) claim=QUIZ.zoneClaim 判的比例精确');
for (const n of [37, 200, 1000, 2048]) {
  const p = fakePaint(n);
  PaintSystem.prototype._claimRegion.call(p, region(n), 0, QUIZ.zoneClaim);
  const want = Math.max(1, Math.round(n * QUIZ.zoneClaim));
  const got = p.counts[0];
  ok(got === want, 'n=' + n + ' \u2192 恰好 ' + want + ' 格 (' + (QUIZ.zoneClaim * 100) + '%)', 'got ' + got);
}

console.log('\n3) 挑中的格子是确定的（联机各端必须一致）');
{
  const n = 1000;
  const run = () => {
    const p = fakePaint(n);
    PaintSystem.prototype._claimRegion.call(p, region(n), 1, QUIZ.zoneClaim);
    return Array.from(p.grid);
  };
  ok(JSON.stringify(run()) === JSON.stringify(run()), '同一区域两次结果完全相同');
}

console.log('\n4) 关键平衡保证：zoneClaim 不越过 80% 占领线');
{
  ok(QUIZ.zoneClaim < CAPTURE,
     'zoneClaim=' + QUIZ.zoneClaim + ' < 占领线 ' + CAPTURE + ' \u2192 接诗不会白拿整个区域');
  const p = fakePaint(1000);
  PaintSystem.prototype._claimRegion.call(p, region(1000), 0, QUIZ.zoneClaim);
  ok(share(p, 0) < CAPTURE, '实际覆盖 ' + (share(p, 0) * 100).toFixed(1) + '% < ' + (CAPTURE * 100) + '%');
}

console.log('\n5) counts 与 grid 始终自洽（含已有归属、已死格子）');
{
  const n = 300;
  // 预置：甲 50 格、乙 30 格，其余无主
  const p = fakePaint(n);
  for (let i = 0; i < 50; i++) p.grid[i] = 1;
  for (let i = 50; i < 80; i++) p.grid[i] = 2;
  p.counts = [50, 30];
  PaintSystem.prototype._claimRegion.call(p, region(n), 0, QUIZ.zoneClaim);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) { if (p.grid[i] === 1) a++; else if (p.grid[i] === 2) b++; }
  ok(p.counts[0] === a && p.counts[1] === b, 'counts=(' + p.counts + ') 与 grid 实测=(' + a + ',' + b + ') 一致');
  ok(p.version > 0, 'version 已递增（渲染侧靠它失效缓存）');

  // dead 格子不能被占用
  const q = fakePaint(n);
  q.dead = new Uint8Array(n);
  for (let i = 0; i < n; i++) q.dead[i] = 1;
  PaintSystem.prototype._claimRegion.call(q, region(n), 0, QUIZ.zoneClaim);
  ok(q.counts[0] === 0 && q.counts[1] === 0, '全是死格时一格也不占');
}

console.log('\n6) 边界值不崩');
for (const f of [0, 0.01, 1, 1.5, -1, NaN, undefined]) {
  const p = fakePaint(100);
  try {
    PaintSystem.prototype._claimRegion.call(p, region(100), 0, f);
    ok(true, 'fraction=' + String(f) + ' \u2192 占有 ' + p.counts[0] + ' 格');
  } catch (e) { ok(false, 'fraction=' + String(f) + ' 抛异常', e.message); }
}

console.log('\n' + (fail ? '\u2717' : '\u2713') + ' ' + (fail ? '\u6709\u5931\u8d25' : '\u5168\u90e8\u901a\u8fc7') + '   \u901a\u8fc7 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
