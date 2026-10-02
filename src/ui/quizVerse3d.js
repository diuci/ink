// 丢词大作战 — 接诗题的 3D 呈现（替代原 HUD 方板）
//
// 为什么不用 DOM 面板：接诗是「战斗中抬头看一眼」的机制，方形菜单会把它变成一块贴在屏幕上的
// 2D 卡片，和涂地射击的立体战场割裂。这里改成挂在相机前方的**三维句阵**：上句大字从天而降，
// 三个候选小字跟着砸下来，有透视、有回弹、有落定爆闪，玩家用准星挑一句、按 1/2/3 接。
//
// 为什么用 Sprite + CanvasTexture（而不是文字几何库）：
//   项目是零构建的纯 ES Module，加 troika 之类的字体依赖会破坏部署链路。而仓库里早就有现成
//   做法——poemDecals.js 用 Canvas2D fillText 直接写汉字贴到地面，murals.js 里有同样的中文
//   字体栈常量（ZH）。照抄那条路，零新增依赖。
//
// 为什么挂在相机空间（而不是钉在角色身上）：
//   世界空间的文字会被墙体/角色遮挡，也会随跑动飘出视野。挂在相机前方固定距离上，玩家永远
//   看得见；但它是**透视相机下的 3D 平面**，字降落时近大远小是真的在变，而不是 CSS 缩放。
//
// 交互：游戏里鼠标是 pointer-lock 的，只有 movementX/Y，没有屏幕绝对坐标，所以「点选」不能
// 用鼠标位置，而要用**准星（屏幕中心）指向**——三层候选竖排，中间那层正好压在准星上，不挪
// 鼠标就能选，左右转视角指 1/3 号。
import * as THREE from 'three';

const ZH = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';

// ---- 布局（单位：米）。Group 原点即屏幕中心，也就是准星。
//
// 两个关键点，都是踩过坑才定下来的：
//
// 1) **精灵高度 ≠ 字号**。候选牌有底衬 + 序号圆牌，上句也留了上下 padding，
//    两者的画布都比字高出一截。算层间净空必须用真实画布高（ASK_H / OPT_H）。
//    曾经拿字号当精灵高，上句直接压在第一层候选上。
//
// 2) **上下留白要克制**。留白是按"字号倍数"给的，如果给到 0.5，一张候选牌就有
//    2.24m 高——而层间距只有 1.26m（不足牌高的 6成），三层叠起来把整块句阵撑到
//    近 8m 高，逆推出来的相机距离退到 19m，字反而变得又小又挤。留白收到 0.20
//    之后，牌高≈1.5m、层间距 1.55m，整块高度回到 6m 内，画面比例才舒服。
const ASK_SIZE = 1.10;      // 上句字高（比候选大一档即可；再大就会横向顶满屏幕）
const OPT_SIZE = 1.00;      // 候选字高
const ASK_PAD_Y = 0.18;     // 上句上下留白 / 字号
const OPT_PAD_Y = 0.20;     // 候选上下留白 / 字号
const ASK_CANVAS_H = 1.30 + ASK_PAD_Y * 2;   // 上句画布高 / 字号 = 1.66
const OPT_CANVAS_H = 1.24 + OPT_PAD_Y * 2;   // 候选画布高 / 字号 = 1.64
const ASK_H = ASK_SIZE * ASK_CANVAS_H;       // 上句精灵实际高（米）= 1.826
const OPT_H = OPT_SIZE * OPT_CANVAS_H;       // 候选精灵实际高（米）= 1.640
// 层间距必须 > 牌高，否则相邻两层会压在一起（实测：OPT_DY=1.55 < OPT_H=1.64 时
// 净空 -0.12m）。留 0.30m 呼吸余量即可。
const OPT_DY = 1.94;        // 候选层间距（中间层落在 y=0 = 准星）
const ASK_GAPK = 1.24;      // 上句中心距系数（须 > 1.16 才有字缝）
const OPT_GAPK = 1.20;      // 候选中心距系数
const FLOAT_A = 0.026;      // 上句呼吸幅度（米，±）
const FLOAT_B = 0.020;      // 候选呼吸幅度（米，±）
// 上句高度由候选层推出来，不写死。
//
// 推导（自下而上，别把符号搞反）：
//     候选 0 号顶边 = OPT_DY + OPT_H/2
//     上句底边      = 候选 0 号顶边 + 呼吸余量 + ASK_GAP_V
//     ASK_Y         = 上句底边 + ASK_H/2
// 呼吸余量必须算进去：上句会向下呼吸 FLOAT_A，候选会向上呼吸 FLOAT_B，
// 想留出ASK_GAP_V 的**可见**净空，就得让静态位置再多让开两者呼吸幅度之和。
const ASK_GAP_V = 0.28;
const OPT_TOP = OPT_DY + OPT_H * 0.5;                 // 候选 0 号顶边
const ASK_Y = OPT_TOP + (FLOAT_B + ASK_GAP_V + FLOAT_A) + ASK_H * 0.5;
const BAR_Y = -(OPT_DY + OPT_H * 0.5 + FLOAT_B + 0.40);   // 倒计时条（在最底层候选之下）
const BAR_W = 4.20;
const BAR_H = 0.080;

// ---- 动画
const FALL_FROM = 7.2;     // 从多高砸下来
const FALL_TIME = 0.46;
const STAGGER = 0.13;      // 候选逐层延迟
const LEAVE_TIME = 0.60;
const FILL = 0.62;         // 句阵占画面高度的比例（用来反推相机距离）
const FILL_W = 0.62;       // 同上，宽度方向——5个汉字很宽，宽度往往才是真正的约束
const PICK_RANGE = 0.42;   // 准星离候选层多远之内才算指到（NDC 单位，半屏高= 1）

const CREAM = '#fdf6e6';
const ACCENT = '#ff8a14';

// 画布像素密度（每米多少像素）。**不能拿世界尺寸（米）当画布像素**——
// 那会让 H≈4px、而描边线宽 = 字高×0.21 ≈ 0.78px，整张图被描边糊满，字完全不可辨
// （poemDecals.js 的文件头注释记的就是这个坑）。给一个独立的分辨率常量，
// 让画布像素只跟"要画多细"有关，跟"占多少米"无关。
const PX_PER_M = 260;

const _wp = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _ndc = new THREE.Vector3();

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

// ---------------------------------------------------------------- 贴图绘制
//
// 全部在**设备像素**里算，字号取整数。踩过的坑：早先版本用 g.scale(260,260) 想把单位
// 从像素换成米，好让 gap / lineWidth 直接写物理尺寸——但那样 g.font 就成了 '1.28px' 这种
// 小数像素，浏览器会把它舍入/钳制，glyph 实际大小和字距脱节，五个字糊成一团。
// poemDecals.js 早就是"按像素算、字号取整"的做法，这里照抄。
const S = PX_PER_M;                       // 米 → 画布像素
const _ctxFont = (meters) => `900 ${Math.round(meters * S)}px ${ZH}`;
/** 物理尺寸（米）→ 至少 1 像素的整数线宽。lineWidth 为 0 会被浏览器当成"极细"处理。 */
const px0 = (meters, k = 1) => Math.max(1, Math.round(meters * S * k));

/** 上句：纯汉字条，无底衬——更大更透气，视觉上是"引子"。 */
function askTexture(text, size) {
  const chars = [...text];
  const gap = size * ASK_GAPK;            // 中心距（米）
  const padX = size * 0.34, padY = size * ASK_PAD_Y;
  const inkW = (chars.length - 1) * gap + size;        // 墨迹宽：首字左缘→末字右缘
  const boxW = inkW + padX * 2;
  const boxH = size * ASK_CANVAS_H;      // 与布局常量共用，保证 ASK_H 与实际画布一致
  const W = Math.ceil(boxW * S), H = Math.ceil(boxH * S);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineCap = 'round';
  const px = px0(size);                   // 字高（画布像素，整数）
  const cy = H / 2;
  g.font = _ctxFont(size);
  chars.forEach((ch, i) => {
    const x = (padX + size * 0.5 + i * gap) * S;
    g.strokeStyle = 'rgba(8,6,14,.82)'; g.lineWidth = px * 0.115;
    g.strokeText(ch, x, cy);
    g.strokeStyle = CREAM; g.lineWidth = px * 0.030;
    g.strokeText(ch, x, cy);
    g.fillStyle = CREAM; g.fillText(ch, x, cy);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return { tex, aspect: W / H };
}

/**
 * 候选牌：序号圆牌 + 一整句汉字。深色底衬保证任何场景亮度下都读得出来。
 *
 * 排版要点：汉字是方块字，字形宽度 ≈ 字号，所以**中心距必须明显大于字号**才有字缝
 * （曾经用 gap = size×1.10，只比字形宽 10%，四个字就粘成一片）。序号圆牌也要
 * 单独占一列并留出净空，否则会盖住第一个字。宽度按「首字左缘→末字右缘的墨迹宽」
 * 来算，而不是"中心距 × 字数"——后者会多算半格，导致右侧留白过大。
 */
function cardTexture(text, size, badge) {
  const chars = [...text];
  const gap = size * OPT_GAPK;             // 中心距（米），须 > size 才有字缝
  const badgeR = size * 0.44;
  const padX = size * 0.42;
  const padY = size * OPT_PAD_Y;
  const badgeCx = padX + badgeR;                       // 圆牌圆心
  const textX0 = padX + badgeR * 2 + size * 0.30;      // 文字墨迹左缘
  const inkW = (chars.length - 1) * gap + size;        // 首字左缘 → 末字右缘
  const boxW = textX0 + inkW + padX;
  const boxH = size * OPT_CANVAS_H;      // 与布局常量共用，保证 OPT_H 与实际画布一致
  const W = Math.ceil(boxW * S), H = Math.ceil(boxH * S);

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineCap = 'round';

  const r = boxH * 0.30 * S;
  g.fillStyle = 'rgba(12,9,20,.66)';
  g.beginPath();
  g.moveTo(r, 0); g.lineTo(W - r, 0); g.quadraticCurveTo(W, 0, W, r);
  g.lineTo(W, H - r); g.quadraticCurveTo(W, H, W - r, H);
  g.lineTo(r, H); g.quadraticCurveTo(0, H, 0, H - r);
  g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.18)';
  g.lineWidth = px0(size, 0.028); g.stroke();

  // 序号圆牌（独立一列）
  g.beginPath(); g.arc(badgeCx * S, H / 2, badgeR * S, 0, Math.PI * 2);
  g.fillStyle = '#fdf6e6'; g.fill();
  g.fillStyle = '#15121c';
  g.font = _ctxFont(badgeR * 1.1);
  g.fillText(String(badge), badgeCx * S, H / 2 + badgeR * 0.06 * S);

  // 汉字：深描边打底 + 本色填充
  const px = px0(size);
  g.font = _ctxFont(size);
  const cy = H / 2;
  chars.forEach((ch, i) => {
    const x = (textX0 + size * 0.5 + i * gap) * S;
    g.strokeStyle = 'rgba(8,6,14,.85)'; g.lineWidth = px * 0.115;
    g.strokeText(ch, x, cy);
    g.strokeStyle = CREAM; g.lineWidth = px * 0.032;
    g.strokeText(ch, x, cy);
    g.fillStyle = CREAM; g.fillText(ch, x, cy);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return { tex, aspect: W / H };
}

/** 倒计时条：纯白圆头条，靠 scale.x 收缩。 */
function barTexture() {
  const W = 256, H = 16;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.roundRect(0, 0, W, H, H / 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSprite(tex, aspect, heightM) {
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
    toneMapped: false, fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(heightM * aspect, heightM, 1);
  s.renderOrder = 40;
  s.userData.aspect = aspect;
  s.userData.baseW = heightM * aspect;
  return s;
}

// ---------------------------------------------------------------- 主体

export class QuizVerse3D {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'QuizVerse';
    this.root.visible = false;
    scene.add(this.root);

    this.askSlot = new THREE.Group();
    this.root.add(this.askSlot);

    this.optSlots = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      this.root.add(g);
      this.optSlots.push(g);
    }

    this.bar = makeSprite(barTexture(), 16, BAR_H);
    this.bar.material.color.set(ACCENT);
    this.bar.position.set(0, BAR_Y, 0);
    this.bar.visible = false;
    this.root.add(this.bar);

    this.live = false;
    this.shown = false;
    this.hover = -1;
    this.phase = 'idle';        // idle | drop | hold | leave
    this.t = 0;
    this.items = [];            // { i, sprite, y, lag, flash, lift }
    this.askSprite = null;
    this._dist = 0;
    this._correct = -1;
  }

  get active() { return this.live; }

  /**
   * 软收起 / 恢复：只切换可见性，保留题目与动画进度。
   * 暂停、开俯视战术图这类"暂时不想看见"的场合用它——回来时原样接着显示，
   * 而不是重新降落一遍（那会像是出了新题）。真正结束一题才用 hide()。
   */
  setShown(v) {
    v = !!v;
    if (this.shown === v) return;
    this.shown = v;
    this.root.visible = v && this.live;
  }

  // ---------------------------------------------------------------- 出题 / 收题

  show(state) {
    if (!state) { this.hide(); return; }
    this._wipe();

    this.hover = -1;
    this.items = [];
    this.phase = 'drop';
    this.t = 0;
    this._correct = -1;
    this._dist = 0;

    if (state.ask) {
      const { tex, aspect } = askTexture(state.ask, ASK_SIZE);
      const s = makeSprite(tex, aspect, ASK_H);   // 传画布高，不是字号
      // 初始状态就摆到"高空 + 透明 + 倾斜"：位置由 update 推进，但出题这一刻必须已经
      // 是在天上，否则第一帧之前它会堆在原点闪一下
      s.position.y = FALL_FROM;
      s.material.rotation = 0.45;
      s.material.opacity = 0;
      this.askSlot.add(s);
      this.askSprite = s;
      this._own(tex);
    }

    const opts = state.options || [];
    opts.slice(0, 3).forEach((o, i) => {
      const { tex, aspect } = cardTexture(o.text, OPT_SIZE, i + 1);
      const s = makeSprite(tex, aspect, OPT_H);   // 传画布高，不是字号
      s.position.y = FALL_FROM;
      s.material.rotation = i % 2 ? 0.40 : -0.40;
      s.material.opacity = 0;
      this.optSlots[i].add(s);
      // 层偏移只放在**精灵自己**上，optSlots 容器保持原点。曾经两边都设了一遍，
      // 结果 0/2 号候选被抬到 ±2×OPT_DY（和上句撞在同一高度、视觉上叠字），
      // 而中间那层因为 OPT_DY*(1-1)=0 恰好没受影响——所以只有 1/3 号在错的位置。
      this.optSlots[i].position.set(0, 0, 0);
      const y = OPT_DY * (1 - i);      // i=1 → y=0，正好压在准星上
      this.items.push({ i, sprite: s, y, lag: 0.22 + i * STAGGER, flash: 1, lift: 0 });
    });

    this.live = true;
    this.shown = true;
    this.root.visible = true;
  }

  hide() {
    if (!this.live && !this.root.visible) return;
    this.live = false;
    this.shown = false;
    this.phase = 'idle';
    this.root.visible = false;
    this.bar.visible = false;
    this.hover = -1;
    this._wipe();
  }

  /** 收尾：正确项向上炸开飞散，其余原地淡出。 */
  resolve(correctIdx) {
    if (!this.live) return;
    this._correct = correctIdx;
    this.phase = 'leave';
    this.t = 0;
  }

  _wipe() {
    for (const g of this.optSlots) this._clearGroup(g);
    this._clearGroup(this.askSlot);
    for (const d of this._texes || []) d.dispose();
    this._texes = [];
    this.items = [];
    this.askSprite = null;
  }

  _own(tex) { (this._texes || (this._texes = [])).push(tex); }

  _clearGroup(g) {
    while (g.children.length) {
      const c = g.children.pop();
      c.material?.dispose?.();
    }
  }

  // ---------------------------------------------------------------- 每帧

  /**
   * @param camera 透视相机
   * @param info   { timeLeft, timeLimit }  剩余时间比例（可选，用于倒计时条）
   */
  update(dt, camera, info = {}) {
    if (!this.live || !camera) return;
    this.t += dt;

    // ---- 摆位：句阵挂在相机前方，距离由「句阵占画面的比例」反推（随 FOV / 画幅自适应）。
    //
    // 推导：在距离 d 处、画面高度方向张开的角度是 2·tan(fov/2)，所以画面在 d 处的
    // 世界高度 = 2·d·tan(fov/2)。要让块高 blockH 恰好占画面高度的 FILL 比例：
    //
    //     blockH / (2·d·tanHalf) = FILL   ⟹   d = blockH / (2·tanHalf·FILL)
    //
    // 注意 FILL 是在**分母**——FILL 越大表示"允许占更多画面"，句子可以更近更大。
    // 写成乘法会把距离算得过近（clamp 到下限，字糊满屏幕）。
    //
    // 还要**同时**约束宽度：一句 5 字有 3~5 米宽，只按高度算的话横向会冲出屏幕。
    // 两者取最大值——宽高任一超了就往远处退。
    //
    // 曾经一度以为「距离太远会被透视压扁」，于是把 FILL 提到 0.88 把句子拉近，
    // 结果更糟——真正的原因是层偏移被设了两次（容器 + 精灵各一份），0/2 号候选
    // 被抬到 ±2×OPT_DY 正好撞上上句。透视在这个量级其实可以忽略：句阵所有元素
    // 都在相机前方同一个垂直平面上，深度相同，投影是**线性**的，等距世界高度
    // 对应等距 NDC 间距。所以这里老老实实按"占画面多少比例"算距离即可。
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = camera.aspect || 1.78;
    // 块高要从**上句顶边一直量到倒计时条底边**，而不是只量到 0 号候选——
    // 漏掉下半截会把距离算得过近，倒计时条被挤出画面下缘（第一版就漏了）。
    const blockTop = ASK_Y + ASK_H * 0.5;
    const blockBottom = BAR_Y - BAR_H * 0.5;
    const blockH = blockTop - blockBottom;
    const blockW = Math.max(
      this.askSprite ? this.askSprite.userData.baseW : 0,
      ...this.items.map((it) => it.sprite.userData.baseW));
    const dH = blockH / (2 * tanHalf * clamp01(FILL));
    const dW = blockW / (2 * tanHalf * aspect * clamp01(FILL_W));
    const d = Math.max(5, Math.min(24, Math.max(dH, dW)));
    this._dist = this._dist ? this._dist + (d - this._dist) * Math.min(1, dt * 7) : d;
    camera.getWorldDirection(_wp);
    this.root.position.copy(camera.position).addScaledVector(_wp, this._dist);
    this.root.quaternion.copy(camera.quaternion);

    const fading = this.phase === 'leave';
    const fadeOut = fading ? clamp01(1 - this.t / LEAVE_TIME) : 1;

    // ---- 上句：先出场（比候选早），从高处砸下，稳住后轻微呼吸
    if (this.askSprite) {
      const k = clamp01((this.t - 0.06) / FALL_TIME);
      const e = easeOutBack(k);
      const s = this.askSprite;
      const breathe = k >= 1 ? Math.sin(this.t * 1.9) * FLOAT_A : 0;
      s.position.y = FALL_FROM * (1 - e) + ASK_Y * e + breathe;
      s.material.rotation = (1 - e) * 0.45;
      const pop = 1 + (1 - e) * 0.32;
      s.scale.set(s.userData.baseW * pop, ASK_H * pop, 1);
      // 上句常态也要有轻微明暗脉动，否则它是整块里唯一"死"的东西，看着像没落地
      const pulse = k >= 1 ? 0.5 + 0.5 * Math.sin(this.t * 4.2) : 0;
      s.material.opacity = clamp01(k * 1.8) * fadeOut * (k >= 1 ? 0.90 + 0.10 * pulse : 1);
      // 落定瞬间的亮度爆闪，之后回到常亮；常亮比候选略亮（它是题面主角）
      const base = 1.12 + 0.16 * pulse;
      const f = base + 0.9 * this._flash(k);
      s.material.color.setRGB(f, f, f);
    }

    // ---- 候选：逐层降落 + 落定爆闪 + 常态呼吸
    let allLanded = true;
    for (const it of this.items) {
      const k = clamp01((this.t - it.lag) / FALL_TIME);
      const s = it.sprite;
      const baseW = s.userData.baseW;

      if (fading) {
        if (it.i === this._correct) {
          const e = easeOutCubic(clamp01(this.t / LEAVE_TIME));
          s.position.y = it.y + e * 2.8;
          s.material.rotation = e * 0.9;
          const k2 = 1 + e * 0.65;
          s.scale.set(baseW * k2, OPT_H * k2, 1);
          s.material.opacity = (1 - e) * fadeOut;
          const f = 1 + e * 2.2;
          s.material.color.setRGB(f, f, f);
        } else {
          s.material.opacity = 0.14 * fadeOut;
        }
        continue;
      }

      if (k < 1) allLanded = false;
      const e = easeOutBack(k);
      const float = k >= 1 ? Math.sin((this.t - it.lag) * 2.3 + it.i * 1.9) * FLOAT_B : 0;
      s.position.y = FALL_FROM * (1 - e) + it.y * e + float;
      s.material.rotation = (1 - e) * (it.i % 2 ? 0.40 : -0.40);

      // 落定后常态轻微明暗脉动（「闪出来」的持续态）
      const pulse = k >= 1 ? 0.5 + 0.5 * Math.sin((this.t - it.lag - FALL_TIME) * 4.6 + it.i * 1.3) : 0;
      s.material.opacity = clamp01(k * 2.2) * fadeOut * (k >= 1 ? 0.80 + 0.20 * pulse : 1);

      // 准星悬停：放大 + 提亮
      const hov = this.hover === it.i ? 1 : 0;
      it.lift += (hov - it.lift) * Math.min(1, dt * 13);
      const pop = 1 + (1 - e) * 0.30 + it.lift * 0.16;
      s.scale.set(baseW * pop, OPT_H * pop, 1);
      const f = (1 + 0.9 * this._flash(k)) * (1 + it.lift * 0.55);
      s.material.color.setRGB(f, f, f);
    }
    if (this.phase === 'drop' && allLanded) this.phase = 'hold';

    // ---- 倒计时条
    if (info.timeLeft != null && info.timeLimit > 0) {
      const k = clamp01(info.timeLeft / info.timeLimit);
      this.bar.visible = true;
      this.bar.scale.x = BAR_W * k;
      const urg = k < 0.28;
      this.bar.material.color.set(urg ? '#ff3b30' : ACCENT);
      this.bar.material.opacity = fadeOut * (urg ? 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(this.t * 20)) : 0.92);
    } else {
      this.bar.visible = false;
    }

    if (fading && this.t > LEAVE_TIME) this.hide();
  }

  /** 落定瞬间的爆闪包络：k=1 那一刻最亮，之后指数衰减。 */
  _flash(k) {
    if (k < 1) return 0;
    return Math.max(0, Math.sin((k - 1) * 9)) * 0.9;
  }

  // ---------------------------------------------------------------- 准星拾取

  /**
   * 准星指着哪一层候选。
   *
   * 三个候选是水平居中、竖排一列的，所以判定只看**垂直方向**：取 NDC 上离准星
   // (0,0) 最近的那层。不做"必须落在牌面矩形内"的硬判定——牌面半高 0.5m、
   // 层间距 1.34m，中间留着0.34m 的死区，要求玩家瞄得极准才选得上，手感很差。
   * 上下相邻两层的中点就是分界，就近取谁，符合"竖排列表"的直觉。
   */
  pick(camera) {
    if (!this.live || this.phase === 'leave') return -1;
    const dir = camera.getWorldDirection(_wp);
    let best = -1, bestDy = Infinity;
    for (const it of this.items) {
      it.sprite.getWorldPosition(_ndc);
      _rel.copy(_ndc).sub(camera.position);
      if (_rel.dot(dir) <= 0.25) continue;               // 在相机背后
      const k = clamp01((this.t - it.lag) / FALL_TIME);  // 还在半空的不参与拾取
      if (k < 0.55) continue;
      _ndc.project(camera);
      const dy = Math.abs(_ndc.y);
      if (dy < bestDy) { bestDy = dy; best = it.i; }
    }
    // 全部层都离准星很远（玩家在朝天看）时就不高亮，免得凭空指一项
    return bestDy <= PICK_RANGE ? best : -1;
  }

  /** 每帧同步悬停（同时也是玩家「当前会选中哪一项」的视觉指示）。 */
  syncHover(camera) {
    this.hover = this.live ? this.pick(camera) : -1;
    return this.hover;
  }

  dispose() {
    this._wipe();
    this.root.removeFromParent();
  }
}