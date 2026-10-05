// 丢词大作战 — 场景招牌汉化工具
//
// 界面早就全汉化了，但场景里两百来块招牌还是英文——孩子走进游戏看到
// "CARGO TERMINAL"、"MARKET HALL"、"TOWN HALL" 这种字，既割裂又看不懂。
//
// 踩过的坑（v1 的教训）：
//   只盯着 letters(B, '…') / text(B, '…') 是**不够**的。招牌文本散落在很多种上下文里：
//     · 三元表达式  letters(B, v ? 'CUSTOM HOUSE' : 'TOWN HALL', …)
//     · 店招数组    const SHOPS = [['PENNY ARCADE', '#7a3b67', …], …]
//     · 属性        { type: '…_streetname', text: 'JUBILEE', sub: '1887' }
//     · 指路牌      arms: [[90, 'MARKET HALL'], …]  以及它的默认值 [['PIER', 90], …]
//     · Canvas2D    murals.js 里的墙面铭文
//   所以这里改成**按整行感知**：跳过 desc: 注释行，其余行里凡是在译名表里的引号串都换掉。
//
// 译名原则：与 src/config.js 里已经定下的地图中文名保持一致
//   （tidewater 潮水广场 / kelpline 海带码头 / cargo 货运码头 / crossmarket 十字集市 /
//     lockgate 闸门运河 / saltpan 盐田盆地 / terraces 台地山村 / halyard 索具船坞），
//   否则菜单说"潮水广场"、墙上却写 TIDEWATER，又是一处不一致。
//
// 用法：
//   node tools/zh-signs.mjs --check   只体检，列出仍是英文的招牌（严格只读）
//   node tools/zh-signs.mjs --apply   按译名表替换
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 译名表：只放「玩家真会读到的招牌」
const SIGNS = {
  // —— tidewater 潮水广场（维多利亚海滨）——
  'TIDEWATER PLAZA': '潮水广场',
  'BOROUGH OF TIDEWATER': '潮水自治镇',
  'THE CRESCENT': '新月饭店',
  'CRESCENT': '新月',
  'TOWN HALL': '市政厅',
  'CUSTOM HOUSE': '海关',
  'PENNY ARCADE': '便士游戏厅',
  'THE ANCHOR': '铁锚号',
  'ROCK SHOP': '奇石店',
  'FISH & CHIPS': '炸鱼薯条',
  'POST OFFICE': '邮局',
  'ICES & TEAS': '冰饮茶座',
  'BUCKETS & SPADES': '桶铲玩具',
  'SEASIDE GIFTS': '海滨礼品',
  'SWEETS': '糖果铺',
  'GIFTS': '礼品店',
  'ALES': '麦酒馆',
  'IN MEMORIAM': '永志不忘',
  'LOST AT SEA': '海上罹难',
  'MARINE PARADE': '海滨长街',
  'PALACE PIER': '皇宫码头',
  'VICTORIA PIER': '维多利亚码头',
  'PIER': '码头',
  'HALL LANE': '会堂巷',
  'JUBILEE': '禧年',
  'MARKET PASSAGE': '市场通道',

  // —— crossmarket 十字集市 ——
  'CROSSROADS MARKET': '十字集市',
  'CORN EXCHANGE': '谷物交易所',
  'EXCHANGE SQUARE': '交易所广场',
  'FISH MARKET': '鱼市',
  'MARKET HALL': '市场大厅',
  'MARKET STREET': '市场街',
  'TRAM STREET': '电车街',
  'FISH LANE': '鱼巷',
  'HARBOUR': '港口',
  'THE PARADE': '长堤',
  'CATCH OF THE DAY': '今日鲜货',
  'SMOKEHOUSE': '熏鱼房',
  'CHANDLER': '杂货铺',
  'BUTCHER': '肉铺',
  'FLORIST': '花店',
  'BAKERY': '面包房',
  'BOOKS': '书店',
  'CHEESE': '奶酪',
  'OYSTER BAR': '牡蛎吧',
  'OYSTERS': '生蚝',
  'KIPPERS': '腌鲱鱼',
  'FRESH FISH': '鲜鱼',
  'FISH': '鱼铺',
  'FLOWERS': '鲜花',
  'FRUIT': '水果',
  'BREAD': '面包',
  'SPICES': '香料',
  'WINES': '酒庄',
  'CAFE': '咖啡馆',
  'MENU': '菜单',
  'THEATRE': '剧院',
  'CIRCUS': '马戏团',
  'OPERA': '歌剧院',
  'REGATTA': '赛舟会',
  'INN': '客栈',
  'COCOA': '可可屋',
  'HERRING': '鲱鱼铺',
  'SOAP': '香皂铺',
  'IRONMONGER': '五金店',
  'TEA ROOMS': '茶室',
  'TICKETS': '售票处',
  'TRAM STOP': '电车站',
  'TRAMWAYS': '电车',
  'TRAMS': '电车',
  'CROSSROADS': '十字街',
  'MARKET': '市集',

  // —— cargo / kelpline 货运码头 · 海带码头 ——
  'CARGO TERMINAL': '货运码头',
  'KELPLINE TERMINAL': '海带码头',
  'CARGO': '货运',
  'KELPLINE': '海带',
  'TERMINAL OPERATIONS': '码头作业区',
  'TERMINAL': '航站楼',
  'HARD HAT AREA': '必须戴安全帽',
  'MUSTER POINT': '集合点',
  'GIVE WAY TO': '减速让行',
  'HI-VIS · BOOTS · HELMET': '荧光衣 · 劳保鞋 · 安全帽',
  'CREW ONLY': '仅限船员',
  'THIS WAY UP': '此面朝上',
  'SHORE POWER': '岸电',
  'STRADDLES': '跨运区',
  'REEFER ': '冷藏箱 ',   // 注意尾部空格：后面还要拼箱号
  'BERTH 4': '4 号泊位',
  'GATE 4': '4 号闸口',
  'EXIT': '出口',

  // —— lockgate 闸门运河 ——
  'LOCKGATE CANAL CO': '闸门运河公司',
  'LOCKGATE': '闸门',
  'LOCK CLOSED': '闸门关闭',
  'LOCK HOUSE': '闸房',
  'LOCKS': '船闸',
  'LOCK 2': '2 号闸',
  'BRIDGE 2': '2 号桥',
  'ANCHOR MILLS': '铁锚磨坊',
  'ANCHOR WAREHOUSE': '铁锚货栈',
  'COOPERAGE': '制桶铺',
  'No 1 WAREHOUSE': '一号货栈',
  'BONDED STORES': '保税仓库',
  'BOATS FOR HIRE': '租船处',
  'NOTICE TO BOATMEN': '船户须知',
  'BEWARE OF THE LOCK': '当心船闸',
  'NO MOORING': '禁止泊船',
  'NO SWIMMING': '禁止游泳',
  'KEEP CLEAR': '勿要堵塞',
  'TOWPATH': '纤道',
  'WHARF': '码头',
  'DEAD SLOW': '慢速行驶',
  'FOR REPAIR': '待修',
  'DANCE': '舞厅',
  'TURF WAR': '涂地争霸',
  'BASIN': '闸室',
  'MILE': '英里',

  // —— saltpan 盐田盆地 ——
  'SALTPAN BASIN': '盐田盆地',
  'SALTPAN': '盐田',
  'SALT CO. · 1889': '盐业公司 · 1889',
  'GREAT PAN': '大盐池',
  'PACKING SHED': '包装棚',
  'WORKS OFFICE': '盐场办公室',
  'KEEP OFF THE HEAP': '勿上盐堆',
  'NO BARROWS': '禁止堆肥',
  'SOFT BRINE': '淡卤水',
  'LOFT': '盐仓阁',
  'DANGER': '危险',
  'PAN 2': '2 号池',
  'PAN 3': '3 号池',
  'PAN 4': '4 号池',
  'PAN 6': '6 号池',
  'PAN 7': '7 号池',

  // —— terraces 台地山村（意大利海滨村镇）——
  'VILLA LIMONI': '柠檬别墅',
  'SAN VITO': '圣维托',
  'VICOLO DEL SOLE': '阳光巷',
  'LIMONCELLO': '柠檬酒',
  'CERAMICHE': '瓷砖行',
  'GIARDINO': '花房',
  'STAZIONE': '小车站',
  'FUNICOLARE': '缆车',
  'PASSO': '山道',
  'ACQUA': '水铺',
  'BIGLIETTI': '大利铁铺',
  'GIORNALI': '报刊',

  // —— halyard 索具船坞 ——
  'THE GALLEY': '船尾楼',
  'CHANDLERY': '船具铺',
  'UNLEADED': '无铅汽油',
  'DIESEL': '柴油',

  // —— 零散：潮汐时刻牌、指路牌默认臂、店招简称、门牌号 ——
  // 潮水广场的潮汐表：HW = high water（高潮），LW = low water（低潮）
  'HW 06:12': '高潮 06:12',
  'LW 12:31': '低潮 12:31',
  'HW 18:40': '高潮 18:40',
  'LW 00:55': '低潮 00:55',
  'BANDSTAND': '音乐亭',
  'ROCK': '奇石',
  'POST': '邮局',
  'NO. ': '编号 ',
  'FRUIT & VEG': '果蔬',
  'CARRIERS & WHARFINGERS': '承运人与码头工',
  'CAFFÈ': '咖啡馆',
};

// 故意保留英文的。这些在现实里本就不翻译，翻成中文反而假：
//   船名、船东/船公司名、集装箱箱号与箱主代码、船舶铭牌参数、设备编号、皇家徽记。
// 另有一批是内部标识（坐标系统 YXZ、字体名、environment.js 的类名、布局角标
// BL/BR/LA/LB、罗马数字），根本不是招牌，也不该动。
const KEEP = new Map(Object.entries({
  // 船名
  'HALCYON': '船名', 'KITTIWAKE': '船名', 'MARGUERITE': '船名', 'MARY ANN': '船名',
  'PIPIT': '船名', 'TERN': '船名', 'REEL TIME': '船名', 'SEA BISCUIT': '船名',
  // 船公司 / 船东
  'TIDEBANK': '航运公司名', 'CORAL MAX': '航运公司名', 'CORAL MAXIMA': '航运公司名',
  'KRAKEN LINES': '航运公司名', 'KRAKEN': '航运公司名',
  // 集装箱箱主代码与箱号
  'TDBU': '箱主代码', 'CRLU': '箱主代码', 'INKU': '箱主代码', 'KLPU': '箱主代码',
  'KRKU': '箱主代码', 'TIDU': '箱主代码', 'HLBU': '箱主代码', 'SLTU': '箱主代码',
  'KLPU 204816': '集装箱箱号', 'KRKU 882130': '集装箱箱号', 'KRKU 204519': '集装箱箱号',
  'BLOOP 555-0142': '电话号码占位符',
  // 集装箱上的作业标记
  'LASHING GANG': '作业班组标记', 'REEFER TECH': '冷藏箱检修标记',
  // 船舶铭牌 / 设备编号 / 徽记
  'SWL 35 T': '安全工作载荷（船舶铭牌）', 'SWL 65 T': '安全工作载荷（船舶铭牌）',
  'HM': 'Her Majesty 皇家船籍前缀', 'HM 1': '皇家船名编号',
  'KL 204': '船体编号', 'RTG 22': '龙门吊设备编号',
  'VR': '维多利亚女王皇家徽记 cypher', 'SQD·042': '舱位编号',
  'NO 2': '驳船编号（船名就在它下面：十字集市）',
  'FM': '调频缩写标记',
  'KM/H': '单位符号（中国限速牌同样写 km/h，译成「公里/时」反而撑破小牌）',
  'SALT SPRAY': '船名',
  'KRKU 204519  3': '集装箱箱号（含载重）',
  'MAX GROSS 30,480 KG': '船舶铭牌：总吨位',
  'TARE 2,200 KG': '船舶铭牌：空载重量',
  'SQD · 042': '舱位编号',
  'MARINA': '内部场景标识', 'FX': '内部标记',
  'BL': '布局角标（左下）', 'BR': '布局角标（右下）',
  'LA': '布局角标（左）', 'LB': '布局角标（左下沿）', 'TL': '布局角标（上）',
  // 内部标识，非招牌
  'YXZ': '世界坐标系名', 'Rubik': '字体名',
  'InkwavePropsDisplay': '内部类名', 'InkwavePropsText': '内部类名',
}));

// 不在 letters()/text() 里、但也不能按上面的通用规则换的整串（多词拼接、罗马数字等）
const EXTRA = [
  ['src/world/stages/tidewater/murals.js', "'禧年台 · MDCCCLXXXVII · '", "'禧年台 · 一八八七 · '"],
];

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = walk('src/world');

const apply = process.argv.includes('--apply');
const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);
const looksEnglish = (s) => /[A-Z]{2}/.test(s) && !hasCJK(s);

// 根本不是招牌的东西，不该混进「漏译」清单：
//   HZ_CITY / PREP_SWITCH 这类常量、sailAF 这类道具标识符、
//   着色器源码与括号注释残片、跨行漏下来的英文散文、罗马数字。
const CODEY = '[]{}();';
const isNoise = (s) =>
  /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(s)
  || /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/.test(s)
  || /^[a-z]+[A-Z]/.test(s)
  || Array.from(CODEY).some((ch) => s.includes(ch))
  || s.split(/[\s,]+/).length > 4;

// desc: 是给开发者看的英文道具说明，不是给玩家看的字，别动。
const skipLine = (l) => /^\s*\/\//.test(l) || /\bdesc\s*:/.test(l);

let changedFiles = 0, replaced = 0;
const leftovers = new Map();   // 串 -> 出现次数

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split('\n');
  let touched = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipLine(line)) continue;
    if (!/'/.test(line)) continue;
    const next = line.replace(/'([^']*)'/g, (m, s) => {
      if (hasCJK(s) || KEEP.has(s)) return m;         // 已是中文 / 故意保留
      const zh = SIGNS[s];
      if (!zh) { if (looksEnglish(s) && !isNoise(s)) leftovers.set(s, (leftovers.get(s) || 0) + 1); return m; }
      replaced++; touched = true;
      return "'" + zh + "'";
    });
    lines[i] = next;
  }
  let out = lines.join('\n');
  for (const [file, from, to] of EXTRA) {
    if (f.endsWith(file.replace(/\//g, '/')) && out.includes(from)) {
      out = out.split(from).join(to); replaced++; touched = true;
    }
  }
  // 只有 --apply 才落盘。--check 必须严格只读，否则「体检」会悄悄改源码。
  if (touched && apply) { writeFileSync(f, out, 'utf8'); changedFiles++; }
}

function report() {
  console.log('[zh-signs] 扫描 ' + files.length + ' 个文件（src/world）');
  if (apply) console.log('[zh-signs] 替换 ' + replaced + ' 处，落到 ' + changedFiles + ' 个文件');
  else console.log('[zh-signs] --check 模式，未改动任何文件（加 --apply 生效）');
  if (leftovers.size) {
    console.log('[zh-signs] 译名表里没有、仍是英文的可疑串 ' + leftovers.size + ' 种：');
    for (const [s, n] of [...leftovers].sort((a, b) => b[1] - a[1])) console.log('    ' + s + '   ×' + n);
  }
}
report();
process.exit(leftovers.size ? 1 : 0);
