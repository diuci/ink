// 招牌排版溢出风险自查：中文比英文长的话，牌子可能放不下。
import { readFileSync } from 'node:fs';
const src = readFileSync('tools/zh-signs.mjs', 'utf8');
const body = src.slice(src.indexOf('const SIGNS'), src.indexOf('// 故意保留英文的'));
const re = /'([^']+)':\s*'([^']+)'/g;
const rows = [];
let m;
while ((m = re.exec(body))) {
  const en = m[1], zh = m[2];
  // 粗略宽度权重：汉字按 1 个字宽算（等于 2 个拉丁字母宽），英文按 0.55
  const wEn = [...en].reduce((a, c) => a + (c.charCodeAt(0) < 128 ? 0.55 : 1), 0);
  const wZh = [...zh].reduce((a, c) => a + (c.charCodeAt(0) < 128 ? 0.55 : 1), 0);
  rows.push({ en, zh, ratio: wZh / (wEn || 1), wEn, wZh });
}
rows.sort((a, b) => b.ratio - a.ratio);
console.log('译后宽度 / 原宽度 —— 比值越大越可能撑出牌子\n');
console.log('比值  原宽  译宽  英文 -> 中文');
for (const r of rows.slice(0, 18)) {
  const flag = r.ratio > 1 ? '  <== 变长' : '';
  console.log(
    r.ratio.toFixed(2).padStart(4) + '  ' +
    r.wEn.toFixed(1).padStart(4) + '  ' + r.wZh.toFixed(1).padStart(4) + '  ' +
    r.en.padEnd(24) + ' -> ' + r.zh + flag);
}
const longer = rows.filter((r) => r.ratio > 1);
console.log('\n共 ' + rows.length + ' 条，其中变长 ' + longer.length + ' 条');
