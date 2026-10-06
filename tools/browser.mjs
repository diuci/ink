/**
 * 找一个能用的 Chrome / Edge 可执行文件。
 *
 * 为什么需要这个：tools/ 下十个浏览器工具原先都写死了 macOS 的路径
 *   /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 * 在 Windows 上跑会直接报
 *   FAIL Browser was not found at the configured executablePath
 * 然后退出——其中包括一个叫 smoke-win.mjs 的（讽刺）。
 *
 * 查找顺序：
 *   1. 环境变量 CHROME_PATH（CI 或特殊安装用）
 *   2. 各平台常见的 Chrome 安装位置
 *   3. Edge（Windows 自带，很多机器上也有）
 *
 * 找不到就抛错，并把所有试过的位置都打出来——
 * 原来只报一个 macOS 路径，看不出到底该填什么。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const IS_MAC = process.platform === 'darwin';

export function candidates() {
  if (process.env.CHROME_PATH) return [process.env.CHROME_PATH];
  const list = [];
  if (IS_MAC) {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              '/Applications/Chromium.app/Contents/MacOS/Chromium',
              '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else if (process.platform === 'win32') {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    list.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
              '/usr/bin/chromium', '/usr/bin/chromium-browser',
              '/snap/bin/chromium', '/usr/bin/microsoft-edge');
  }
  return list;
}

export function findBrowser() {
  for (const p of candidates()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (e) { /* 单个路径探测失败就继续试下一个 */ }
  }
  throw new Error('找不到 Chrome/Edge。请设置环境变量 CHROME_PATH。\n试过：\n  '
                  + candidates().join('\n  '));
}

/** Apple Silicon 上才有 --use-angle=metal；别处带上会报参数不认识。 */
export function gpuArgs() {
  return IS_MAC
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--enable-gpu', '--ignore-gpu-blocklist'];
}
