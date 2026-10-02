// 丢词大作战 — Windows 版 smoke 测试（原 tools/smoke.sh 是 POSIX shell 且硬编码 macOS Chrome 路径）。
// 用法： node tools/smoke-win.mjs [url]
// 启动游戏 → 自动驾驶 8 秒 → 检查 console 错误 → 打印状态。有错误则退出码 1。
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_ = process.argv[2] || 'http://127.0.0.1:8490/?autostart=60&autopilot&shadercheck';

// 找一个可用的 Chrome/Edge（Windows / macOS / Linux 都试）
const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const exe = CANDIDATES.find((p) => p && existsSync(p));
if (!exe) { console.log('SMOKE FAIL — 找不到 Chrome/Edge'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const kill = () => { try { browser.process()?.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', kill);
const watchdog = setTimeout(() => { console.log('SMOKE FAIL — 看门狗超时'); kill(); process.exit(2); }, 300000);
watchdog.unref?.();

const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error') errs.push('[error] ' + m.text()); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));

// 无头软件渲染下启动很慢（首次着色器编译 + 程序化资源生成），给足时间
const BOOT_TIMEOUT = 240000;
try {
  await page.goto(URL_, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(
    'window.__inkwave && __inkwave.match && __inkwave.match.local',
    { timeout: BOOT_TIMEOUT, polling: 300 },
  );
  // 等对局真正进入 playing（intro 有 3.6 秒）
  await page.waitForFunction('__inkwave.match.state === "playing"', { timeout: 60000, polling: 200 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 8000));
  // 顺带验证中文化是否真的生效（标题 + 武器名 + 地图名）
  const st = await page.evaluate(`JSON.stringify({
    state: __inkwave.match.state,
    boot: __inkwave.bootMs,
    fps: __inkwave.fps,
    mode: __inkwave.match.mode,
    map: __inkwave.mapDef && __inkwave.mapDef.name,
    weapon: __inkwave.match.local.weapon && __inkwave.match.local.weapon.name,
    poem: __inkwave.match.local.poem && __inkwave.match.local.poem.title,
    poems: __inkwave.match.actors.map(a => a.poem && a.poem.title).filter(Boolean),
    links: __inkwave.match.links ? __inkwave.match.links.length : 0,
    turf: __inkwave.match.actors.map(a => Math.round(a.stats.turf)),
    perf: __inkwave.perf,
  })`);
  console.log('smoke ->', st);
} catch (e) {
  errs.push('[fatal] ' + e.message);
}

const real = errs.filter((l) => !/404|preload|Failed to fetch/i.test(l));
if (real.length) { console.log(real.slice(0, 20).join('\n')); console.log('SMOKE FAIL'); await browser.close().catch(() => {}); kill(); process.exit(1); }
console.log('SMOKE OK');
await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
kill();
process.exit(0);
