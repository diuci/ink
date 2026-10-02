// 对照实验：zones 模式的 intro 卡住是否与本次改动无关？
// 做法：临时把 poems.js换回「不引用 JSON」的最小版本，
//若 zones 依旧卡在 intro，则问题与诗库接入无关。
// 用法：node tools/diag-intro.mjs
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})

async function probe(qs, label) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1024, height: 640 })
  await page.goto(`http://127.0.0.1:8490/?${qs}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForFunction('window.__inkwave && __inkwave.match', { timeout: 120000, polling: 200 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 9000))
  const s = await page.evaluate(`(() => {
    const m = window.__inkwave.match
    return { state: m.state, stateT: +(m.stateT||0).toFixed(2), paused: !!m.paused, attract: !!m.attract, practice: !!m.practice, mode: m.mode, time: Math.round(m.time||0) }
  })()`)
  console.log('%-38s %s', label, JSON.stringify(s))
  await page.close()
  return s
}

console.log('（autoStart 无 autopilot，靠 attract 或 autopilot 之一进 playing）\n')
await probe('autostart=60&mode=turf&autopilot', 'turf + autopilot')
await probe('autostart=60&mode=zones&autopilot', 'zones + autopilot')
await probe('mode=zones&autopilot', 'zones 无 autostart')

await browser.close()
