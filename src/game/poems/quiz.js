// 丢词大作战 — 接诗玩法（Quiz）
//
// 玩法：对局中每隔一段时间，屏幕上出现一句诗的**上句**，给三个选项，限时选下句。
//   · 答对 → 全队大招能量补给 + 屏幕「好句！」 + 在你脚下刻出这两句
//   · 答错 → 只补墨，不罚
//   · 超时 → 什么都不给
//
// 交互双通道：
//   · 按键 1/2/3（默认）
//   · 语音念出来（可选，settings.voiceQuiz）—— 用 Web Speech API
//
// 关键设计：**不暂停游戏**。题目显示在屏幕边缘，玩家一边打一边答。
import { POEMS, poemsOfGrade, poemById } from './poems.js';

// 出题节奏
export const QUIZ = {
  firstDelay: 22,        // 开局多久出第一题（秒）
  gap: [26, 40],         // 两题之间的间隔（秒）
  answerTime: 6.0,       // 答题时限（秒）
  answerTimeEasy: 8.0,   // 低难度放宽
  options: 3,            // 选项数
  rewardSpecial: 0.5,    // 答对给全队的大招能量（占满格的比例）
  rewardInk: 1.0,        // 答对补满墨
  wrongInk: 0.35,        // 答错只补一点墨
  teamReveal: true,      // 全队看到谁接上了

  // 答对时把脚下那个区域「判给本队」的格子比例（0~1），其余的还得自己涂。
  //
  // 为什么不是 1：zones 的占领线是「覆盖 ≥ 80% 才拿下区域」，比例给满等于
  // 答对一题就白拿整个区域，直接架空了占点玩法——接诗比涂地快太多。
  // 0.6 的理由：离 80% 只差 20%，队友补一补就能拿下，奖励依然很重、很有仪式感；
  // 同时对手只要往回涂 40% 就能把已占的区域拉回中立（zones 的 contest 线），
  // 所以这个奖励是「抢到手」而不是「锁定」。
  // 想更保守调到 0.4，想还原旧行为设成 1。
  zoneClaim: 0.6,

  // 涂地战 / Boss 战脚下没有 zones 区域，答对时改为在答题者脚下**现场围一圈格子**
  // 当落笔处（paint.discRegion）。下面两个参数只管这件事。
  stampRadius: 2.6,   // 围多大地皮（米）。半径 2.6 ≈ 21 m²，是个能看清的字阵大小
  openClaim: 0.5,     // 其中判给本队的比例。
                      // 比 zones 的 0.6 低：涂地战按**面积**计分，答对一题白送的地
                      // 会直接变成比分；0.5 换算下来一次约 10 m²，聊胜于喜但不至于翻盘。
                      // 设成 0 就只刻字不判地。
};

const rnd = (a, b) => a + Math.random() * (b - a);

// 语音匹配的最短可信长度：对上不到这么多字就当作「还没说完」。
// 3 个字是权衡出来的——2 个字太容易和别的选项撞，4 个字又会把
// 「鹅鹅鹅」这类三字短句挡在外面（干扰项本来就都 ≥3 字，见 _makeQuestion）。
const VOICE_MIN = 3;

export class PoemQuiz {
  constructor(match) {
    this.match = match;
    this.active = null;        // { poem, askIndex, options:[poemId], correct:0|1|2, t, limit, answeredBy }
    this.nextAt = QUIZ.firstDelay;
    this.history = [];         // { poemId, by, ok, t }
    this.stats = [0, 0];       // 每队答对次数
  }

  // 从诗库里挑一道题：取一首有配对句的诗，用它的上句问下句
  _makeQuestion(grade) {
    const pool = poemsOfGrade(grade).length ? poemsOfGrade(grade) : POEMS;
    // 候选：必须有 pairs（真正的上下句关系），且每句长度 >= 4（选项太短不好看）
    const cands = pool.filter((p) =>
      p.pairs.length > 0 && p.lines.slice(0, 4).every((l) => l.length >= 4));
    const use = cands.length ? cands : pool.filter((p) => p.pairs.length > 0);
    if (!use.length) return null;

    const poem = use[(Math.random() * use.length) | 0];
    // 按 pairs 取一对，而不是硬编码 lines[0]/lines[1]——这样问的确实是「联句」
    const pair = poem.pairs[(Math.random() * poem.pairs.length) | 0];
    const ask = pair[0];
    const answer = pair[1];
    const askText = poem.lines[ask];
    const correctLine = poem.lines[answer];
    if (!askText || !correctLine) return null;

    // 干扰项：从别的诗里取，长度要和答案接近（差 ≤2），否则一眼就能排除
    const others = [];
    const seen = new Set([correctLine, askText]);
    const okLen = (s) => s && s.length >= 3;
    const pick = () => {
      const q = use[(Math.random() * use.length) | 0];
      if (q.id === poem.id) return null;
      const i = (Math.random() * q.lines.length) | 0;
      const s = q.lines[i];
      if (!okLen(s) || seen.has(s)) return null;
      if (Math.abs(s.length - correctLine.length) > 2) return null;
      seen.add(s);
      return { poemId: q.id, line: i, text: s };
    };
    let guard = 0;
    while (others.length < QUIZ.options - 1 && guard++ < 400) {
      const o = pick();
      if (o) others.push(o);
    }
    // 兜底：放宽长度限制再试一轮
    guard = 0;
    while (others.length < QUIZ.options - 1 && guard++ < 400) {
      const q = use[(Math.random() * use.length) | 0];
      if (q.id === poem.id) continue;
      const s = q.lines[(Math.random() * q.lines.length) | 0];
      if (!okLen(s) || seen.has(s)) continue;
      seen.add(s);
      others.push({ poemId: q.id, line: 0, text: s });
    }
    const opts = [{ poemId: poem.id, text: correctLine, ok: true },
      ...others.map((o) => ({ poemId: o.poemId, text: o.text, ok: false }))];
    // 洗牌（记住正确答案的新位置）
    for (let i = opts.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    const correct = opts.findIndex((o) => o.ok);
    return { poem, askIndex: ask, askText: poem.lines[ask], options: opts, correct };
  }

  update(dt) {
    const m = this.match;
    if (!m || m.state !== 'playing' || m.attract || m.practice) return;
    // 设置里可以关掉接诗答题（G.settings.quiz）
    if (m.quizEnabled === false) { if (this.active) this._resolve(null); return; }
    if (this.active) {
      this.active.t += dt;
      if (this.active.t >= this.active.limit) this._resolve(null);   // 超时
      return;
    }
    this.nextAt -= dt;
    if (this.nextAt > 0) return;
    this._ask();
  }

  _ask() {
    const grade = this.match.opts.grade || 1;
    const easy = (this.match.opts.difficulty || 'normal') === 'easy';
    const q = this._makeQuestion(grade);
    // 题库构造不出来（该年级的诗都不成联句）就顺延到下一轮，不要弹空题
    if (!q) { this.nextAt = QUIZ.gap[0]; return; }
    this.active = { ...q, t: 0, limit: easy ? QUIZ.answerTimeEasy : QUIZ.answerTime, answeredBy: null };
    this.match.emitQuiz?.('ask', this.active);
  }

  // 玩家按键答题（idx 0..2）
  answer(idx, actor = null) {
    const a = this.active;
    if (!a || a.answeredBy) return false;
    const who = actor || this.match.local;
    if (!who) return false;
    const ok = idx === a.correct;
    this._resolve({ actor: who, idx, ok });
    return ok;
  }

  // 语音识别到文本后调用：把「听到的」匹配到某个选项上。
  //
  // 这里踩过两个坑，都是语音识别特有的：
  //
  // 1. **不能第一个命中就break**。识别引擎经常把整句一起吐出来
  //    （continuous + interimResults，下句连着上句一起出），
  //    那时三个选项都在句子里，排在最前的干扰项会先命中 → 直接判错。
  //    所以改成收集**全部**命中项再排序：先看是不是完整念出（exact），
  //    再看对上了几个字。念全句比只对上三个字更可信。
  //
  // 2. **中途结果不能急着结算**。interim 只吐出开头两三个字很常见，
  //    而这几个字又常常正好是某个干扰项的前缀（春眠 / 低头…）。
  //    命中不足 3 个字一律不结算，等他把话说完。
  //
  // isFinal 是识别引擎给的「这句话说完了」标志：中途结果要求更严格。
  answerByText(text, actor = null, isFinal = true) {
    const a = this.active;
    if (!a || a.answeredBy || !text) return null;
    const norm = (s) => String(s).replace(/[^\u4e00-\u9fff]/g, '');
    const said = norm(text);
    if (!said) return null;

    const hits = [];
    for (let i = 0; i < a.options.length; i++) {
      const o = norm(a.options[i].text);
      if (!o) continue;
      // 念出了整句：说的大声里含着它
      if (said.includes(o)) { hits.push({ i, n: o.length, exact: true }); continue; }
      // 只念了一半：它含着说的，且说得够长才算数（否则「春」这种单字会乱命中）
      if (said.length >= VOICE_MIN && o.includes(said)) hits.push({ i, n: said.length, exact: false });
    }
    if (!hits.length) return null;
    hits.sort((x, y) => (y.exact - x.exact) || (y.n - x.n));

    const best = hits[0];
    if (best.n < VOICE_MIN) return null;                      // 对得太少，继续听
    if (!isFinal && !(best.exact && best.n >= VOICE_MIN)) return null;   // 中途结果，多等一下
    // 多个选项对得上、且难分高下（比如把整首诗念了一遍）→ 宁可等，也别乱判。
    // 屏幕上三个选项都摆着，他大可以按 1/2/3。
    if (hits.length > 1 && hits[0].exact === hits[1].exact && hits[0].n === hits[1].n) return null;

    const ok = best.i === a.correct;
    this._resolve({ actor: actor || this.match.local, idx: best.i, ok, byVoice: true });
    return ok;
  }

  _resolve(res) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.nextAt = rnd(QUIZ.gap[0], QUIZ.gap[1]);
    const t = this.match.duration - this.match.time;
    if (res) {
      this.history.push({ poemId: a.poem.id, askIndex: a.askIndex, by: res.actor?.name, ok: res.ok, t, byVoice: !!res.byVoice });
      if (res.ok) this.stats[res.actor?.team ?? 0]++;
    }
    this.match.onQuizResult?.(a, res);
  }

  // HUD 需要的数据
  state() {
    const a = this.active;
    if (!a) return null;
    return {
      ask: a.askText,
      title: a.poem.title,
      options: a.options.map((o, i) => ({ i, text: o.text })),
      correct: a.correct,
      left: Math.max(0, a.limit - a.t),
      limit: a.limit,
    };
  }
}

// ---------------------------------------------------------------- 语音答题（可选）
// Web Speech API：Chrome/Edge/Safari 支持，Firefox 需要 160+。音频会上传到浏览器厂商的服务器。
//
// 识别错误的处置。**必须区分「致命」与「正常」**：
//   no-speech / aborted 在 continuous 模式下会经常出现，那是正常的，不该弹提示；
//   其余的（权限、网络、麦克风）如果不告诉玩家，他只看到红点在闪、
//   永远等不到匹配，还以为是自己念错了——那才是真正劝退的地方。
const VOICE_FATAL = {
  'not-allowed': '麦克风权限被拒绝：点地址栏的权限图标，把它改成「允许」',
  'service-not-allowed': '系统没给这个网页麦克风权限：检查浏览器的站点设置',
  'audio-capture': '找不到麦克风：确认设备已连接、没有被别的程序占用',
  'network': '连不上语音识别服务：识别是在浏览器厂商的服务器上做的，网络不通就识别不了。改用 1/2/3 按键答题即可',
  'language-not-supported': '这个浏览器不支持中文语音识别，换 Chrome/Edge 或用按键答题',
};

export class VoiceAnswer {
  constructor(onText, onError) {
    this.onText = onText;
    this.onError = onError || null;
    this.rec = null;
    this.on = false;
    this.supported = typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    this.lastError = null;
  }

  start() {
    if (!this.supported || this.on) return false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
      const rec = new SR();
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const txt = e.results[i][0]?.transcript;
          if (txt) this.onText(txt.trim(), e.results[i].isFinal);
        }
      };
      rec.onerror = (e) => {
        const code = e.error || 'error';
        this.lastError = code;
        // 只对致命错误喊停；no-speech / aborted 是 continuous 模式的日常噪声
        if (this.onError && VOICE_FATAL[code]) {
          this.on = false;
          try { rec.stop(); } catch { /* already stopped */ }
          this.onError(code, VOICE_FATAL[code]);
        }
      };
      rec.onend = () => { if (this.on) { try { rec.start(); } catch { /* restart guard */ } } };
      rec.start();
      this.rec = rec; this.on = true;
      return true;
    } catch (e) { this.lastError = String(e.message || e); return false; }
  }

  stop() {
    this.on = false;
    try { this.rec?.stop(); } catch { /* gone */ }
    this.rec = null;
  }
}
