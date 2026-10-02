// 丢词大作战 — 诗库（数据源）
//
// 诗文内容不再硬编码在本仓库，统一来自内容仓的构建产物：
//   k12-chinese-poetry（GitHub）→ tools/build.py → data/poems.json
// 快照落在 ./data/poems.json，更新方式见 tools/sync-poems.md。
//
// 这样做的好处：
//   · 单一事实源——改错别字只改内容仓，不必动游戏代码
//   · 游戏仓库保持 no-build-step（直接 import JSON，浏览器原生支持）
//   · 联机对战所有端内容一致（NET.md 的权威性原则要求内容确定性）
//
// 数据结构（Poem）：
//   id            稳定标识，联机同步依赖它，一经发布不再变更
//   title/subtitle 篇名与副标题（「其一」「渔歌子·西塞山前…」）
//   author/dynasty/form 作者、朝代、体裁（五言/七言/词/曲/文言/诗经…）
//   stage/grade/volume 学段、年级、册次
//   lines         整句（已剥离标点），联句与涂地的单位
//   linesPunct    整句（保留标点），供显示与答题用
//   pairs         联句配对，如 [[0,1],[2,3]]；空数组表示无可配对（单句名句）
//   render_split  每整句在地面按逗号拆成几行（贴花层用）
//   recite        背诵要求：full 全文 / section 段落 / line 名句 / none 理解
//   theme/emotion/technique/difficulty/exam_freq  文学常识与玩法权重
//   irregular     已知的不规则之处（如《咏鹅》首句三字重叠），声明后不算校验错误

// JSON 模块需要显式标注 type（Node 18+ / 现代浏览器均要求）。
// 内容是静态的，构建期不做转换——保持 no-build-step。
import DATA from './data/poems.json' with { type: 'json' };

/** 内容版本（与 checksums.json 配套，便于发现本地内容被手改） */
export const CONTENT_VERSION = DATA.contentVersion;

/** 全部篇目 */
export const POEMS = DATA.poems;

/** 按 id 取诗 */
export const poemById = (id) => POEMS.find((p) => p.id === id) || null;

/** 某个年级的全部诗 */
export const poemsOfGrade = (grade) => POEMS.filter((p) => p.grade === grade);

/** 某个学段的全部诗（小学 / 初中 / 高中） */
export const poemsOfStage = (stage) => POEMS.filter((p) => p.stage === stage);

/** 学段清单 */
export const STAGES = [
  { stage: '小学', name: '小学', short: '小学' },
  { stage: '初中', name: '初中', short: '初中' },
  { stage: '高中', name: '高中', short: '高中' },
];

/** 学段名（关卡分组用） */
export const stageName = (s) => (STAGES.find((x) => x.stage === s) || STAGES[0]).name;

/** 兼容旧调用：原来 GRADES 只有 1-9 年级，现在含高中 */
export const GRADES = [
  { grade: 1, name: '小学一年级', short: '一年级' },
  { grade: 2, name: '小学二年级', short: '二年级' },
  { grade: 3, name: '小学三年级', short: '三年级' },
  { grade: 4, name: '小学四年级', short: '四年级' },
  { grade: 5, name: '小学五年级', short: '五年级' },
  { grade: 6, name: '小学六年级', short: '六年级' },
  { grade: 7, name: '初中一年级', short: '初一' },
  { grade: 8, name: '初中二年级', short: '初二' },
  { grade: 9, name: '初中三年级', short: '初三' },
  { grade: 10, name: '高中一年级', short: '高一' },
  { grade: 11, name: '高中二年级', short: '高二' },
  { grade: 12, name: '高中三年级', short: '高三' },
];

export const gradeName = (g) => (GRADES.find((x) => x.grade === g) || GRADES[0]).name;

/**
 * 内容完整性自检：开发期在控制台提示本地快照与内容仓是否一致。
 * 不阻断游戏——内容不同不该导致游戏打不开。
 */
export function verifyContent() {
  const problems = [];
  for (const p of POEMS) {
    if (!p.id || !p.title) problems.push(`${p.id || '(无 id)'}:缺id/title`);
    if (!Array.isArray(p.lines) || p.lines.length === 0) problems.push(`${p.title}:lines 为空`);
    if (!Array.isArray(p.pairs)) problems.push(`${p.title}:pairs 不是数组`);
    for (const [a, b] of p.pairs || []) {
      if (!(a >= 0 && a < p.lines.length) || !(b >= 0 && b < p.lines.length)) {
        problems.push(`${p.title}:pairs 下标越界 [${a},${b}]（共 ${p.lines.length} 句）`);
      }
    }
  }
  if (problems.length) console.warn('[poems] 内容自检发现问题：\n' + problems.join('\n'));
  return problems;
}
