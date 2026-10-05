// 丢词大作战 — 语音答题匹配逻辑测试
//
// 背景：接诗可以开「语音答题」，把下句念出来，由浏览器的 Web Speech API 识别，
// 再用 quiz.answerByText() 做模糊匹配。这里测的正是「识别完之后能不能对上」这一段。
//
// 注意：真正跑 Web Speech API 需要麦克风 + 浏览器厂商的服务器，
// 无头环境里测不了，也不该假装测得了。**这里只测纯逻辑那一半**——
// 识别引擎吐出来的字符串，能不能正确落到某个选项上。
import { PoemQuiz, VoiceAnswer } from '../src/game/poems/quiz.js';

// 造一个刚好够用的假对局（answerByText / _resolve 只用到这几个字段）
function fakeMatch() {
  const settled = [];
  return {
    duration: 300, time: 12, local: { name: '我', team: 0 },
    state: 'playing', attract: false, practice: false,
    quizEnabled: true, opts: { grade: 1, difficulty: 'normal' },
    emitQuiz: () => {},
    onQuizResult: (q, res) => settled.push(res),
    settled,
  };
}

// 造一道题：上句「床前明月光」，三个选项
function armed(correct = 1) {
  const quiz = new PoemQuiz(fakeMatch());
  const opts = [
    { poemId: 'x', line: 0, text: '疑是地上霜' },
    { poemId: 'y', line: 1, text: '举头望明月' },
    { poemId: 'z', line: 2, text: '低头思故乡' },
  ];
  quiz.active = { poem: { id: 'y', lines: ['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡'], title: '静夜思' }, askIndex: 0, askText: '床前明月光', options: opts, correct, t: 0, limit: 6, answeredBy: null };
  return quiz;
}

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  \u2713 ' + label) }
  else { fail++; console.log('  \u2717 ' + label + (extra ? '  ' + extra : '')) }
};
const h = (s) => console.log('\n' + s);

h('1) 念对下句');
{
  const q = armed(1);
  ok(q.answerByText('举头望明月') === true, '完整念出 \u300c举头望明月\u300d \u2192 判对');
  ok(q.match.settled.length === 1, '并且确实结算了一次');
  ok(q.active === null, '题目随即结束');
}

h('2) 识别结果带标点 / 空格（真实识别几乎一定会带）');
{
  const q = armed(1);
  ok(q.answerByText('举头，望明月。') === true, '带逗号句号 \u2192 仍判对');
}
{
  const q = armed(1);
  ok(q.answerByText('举 头 望 明 月') === true, '每个字之间有空格 \u2192 仍判对');
}

h('3) 念的是干扰项 \u2192 应判错（不是 bug，但要确认不会判对）');
{
  const q = armed(1);
  ok(q.answerByText('低头思故乡') === false, '念 \u300c低头思故乡\u300d \u2192 判错');
}

h('4) 完全不相干 \u2192 不应结算，题目继续等');
{
  const q = armed(1);
  ok(q.answerByText('今天天气不错') === null, '不相干的句子 \u2192 返回 null');
  ok(q.match.settled.length === 0, '没有结算');
  ok(q.active !== null, '题目仍然挂着，可以继续念');
}

h('5) \u3010重点\u3013识别把整首诗都吐出来');
{
  // 这种情况没法猜：三个选项都是完整命中，且长度相同。
  // 宁可继续听（屏幕上三个选项都摆着，按 1/2/3 也行），也不要默默判错。
  const q = armed(1);
  ok(q.answerByText('床前明月光疑是地上霜举头望明月低头思故乡') === null,
     '整首一起 \u2192 不乱判，返回 null 继续等');
  ok(q.active !== null, '题目仍然挂着');
  ok(q.answerByText('举头望明月') === true, '随后单独念出下句 \u2192 判对');
}

h('5b) 真实识别分句：先吐上句，再吐下句');
{
  // continuous 模式下引擎会把话切成几句分次送来，这是最常见的形态
  const q = armed(1);
  ok(q.answerByText('床前明月光') === null, '先吐出上句 \u2192 不结算（上句本来不是选项）');
  ok(q.answerByText('床前明月光，举头望明月') === true,
     '接着念出下句 \u2192 判对（上句混在里面也不影响）');
}
{
  // 把上句和一个**干扰项**一起念出来 = 他选了那个干扰项，和按 1/2/3 选错一样，
  // 应该判错。这不是 bug，是一致的行为。
  const q = armed(1);
  ok(q.answerByText('床前明月光，疑是地上霜') === false,
     '念出的是干扰项 \u2192 判错（与按键选错一致）');
}
{
  // 一句话里同时完整念出干扰项和正确项，长度又相同 \u2192 分不出他指哪个，等
  const q = armed(1);
  ok(q.answerByText('疑是地上霜，举头望明月') === null,
     '一句话里两个选项都完整出现 \u2192 不猜，继续等');
  ok(q.active !== null, '题目仍在等待');
}

h('5c) 中途结果 isFinal=false 更严格');
{
  const q = armed(1);
  ok(q.answerByText('低头思', null, false) === null, '中途只对上 3 字（且是干扰项前缀）\u2192 不结算');
  ok(q.answerByText('举头望明月', null, false) === true, '中途结果已完整念出某选项 \u2192 可以结算');
}

h('6) \u3010重点\u3013中途结果抢先命中干扰项（真实语音识别会持续吐 interim）');
{
  // 玩家想说的是「举头望明月」，但 interim 先吐了「低头」，而选项 0 之外的项里
  // 若有以「低头」开头的干扰项，且它排在正确项前面，就会被判错并立刻结束题目。
  const q = new PoemQuiz(fakeMatch());
  const opts = [
    { poemId: 'a', line: 0, text: '低头思故乡' },   // 干扰项排在最前
    { poemId: 'b', line: 1, text: '举头望明月' },   // 正确答案排在后面
    { poemId: 'c', line: 2, text: '疑是地上霜' },
  ];
  q.active = { poem: { id: 'b', lines: [], title: '' }, askIndex: 0, askText: '床前明月光', options: opts, correct: 1, t: 0, limit: 6, answeredBy: null };
  const r = q.answerByText('低头');     // interim 只吐了两个字
  ok(r === null,
     '只念了半个词 \u300c低头\u300d \u2192 不结算、题目不结束',
     'got ' + JSON.stringify(r) + (q.active === null ? '（题目被提前判掉了）' : ''));
  ok(q.active !== null, '题目仍在等待，玩家还有机会念完');
}

h('7) \u3010重点\u3013两个选项存在包含关系时的歧义');
{
  // 若两个选项互为前缀/子串，先遍历到的那个会赢，可能判错。
  const q = new PoemQuiz(fakeMatch());
  const opts = [
    { poemId: 'a', line: 0, text: '春眠' },      // 干扰项：正确答案的前缀
    { poemId: 'b', line: 1, text: '春眠不觉晓' },
    { poemId: 'c', line: 2, text: '处处闻啼鸟' },
  ];
  q.active = { poem: { id: 'b', lines: [], title: '' }, askIndex: 0, askText: '床前明月光', options: opts, correct: 1, t: 0, limit: 6, answeredBy: null };
  const r = q.answerByText('春眠');
  ok(r === null, '念 \u300c春眠\u300d（同时是某选项的全文、另一项的前缀）\u2192 应保持等待而不是乱判',
     'got ' + JSON.stringify(r));
}

h('8) 题目已结束后再喂识别结果，不应二次结算');
{
  const q = armed(1);
  q.answerByText('举头望明月');
  const again = q.answerByText('举头望明月');
  ok(again === null, '结束后再喂 \u2192 返回 null');
  ok(q.match.settled.length === 1, '总结算次数仍是 1，没有重复发奖');
}

h('9) 识别报错的处置（用假的 SpeechRecognition 驱动）');
{
  // 真实识别需要麦克风 + 厂商服务器，测不了；但「拿到错误之后怎么处理」是纯逻辑，
  // 这里用假实现把它钉住。钉不住的代价：识别失败时玩家只看到红点闪、永远匹配不上。
  const makeVoice = (onError) => {
    const rec = {
      lang: '', continuous: false, interimResults: false, maxAlternatives: 0,
      onresult: null, onerror: null, onend: null,
      start() { this.started = true }, stop() { this.stopped = true },
      fire(kind, code) { if (this['on' + kind]) this['on' + kind]({ error: code, resultIndex: 0, results: [] }) },
    };
    globalThis.window = { SpeechRecognition: function () { return rec } };
    const v = new VoiceAnswer(() => {}, onError);
    v.start();
    return { v, rec };
  };

  ok(makeVoice(() => {}).v.supported, '有 SpeechRecognition 时 supported=true');

  // 正常噪声：不该打扰玩家
  for (const code of ['no-speech', 'aborted']) {
    let called = 0;
    const { v, rec } = makeVoice(() => { called++ });
    rec.fire('error', code);
    ok(called === 0, code + ' 是 continuous 模式的日常噪声 \u2192 不弹提示');
    ok(v.on === true, code + ' 之后仍在监听');
  }

  // 致命错误：必须停下来并上报，否则玩家干等
  const FATAL = [
    ['not-allowed', '麦克风权限'],
    ['network', '连不上语音识别服务'],
    ['audio-capture', '找不到麦克风'],
  ];
  for (const [code, expectIn] of FATAL) {
    let got = null;
    const { v, rec } = makeVoice((c, msg) => { got = [c, msg] });
    rec.fire('error', code);
    ok(!!got && got[0] === code, code + ' \u2192 调用了 onError');
    ok(!!got && got[1].includes(expectIn), code + ' 的提示里点明了「' + expectIn + '」',
      got ? 'got: ' + got[1] : 'no callback');
    ok(v.on === false, code + ' \u2192 已停止监听（不再假装在听）');
  }

  // network 这条最要紧：它就是「识别不了」最常见的原因（厂商服务器连不上）
  let netMsg = '';
  { const { rec } = makeVoice((c, m) => { netMsg = m }); rec.fire('error', 'network') }
  ok(netMsg.includes('1/2/3'), 'network 提示里给了「改用 1/2/3」的退路，不会把人卡死');

  // 不支持的浏览器
  globalThis.window = {};
  ok(new VoiceAnswer(() => {}).supported === false, '没有 SpeechRecognition 时 supported=false');
  globalThis.window = undefined;
}

console.log('\n' + (fail ? '\u2717 有失败' : '\u2713 全部通过') + '   通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
