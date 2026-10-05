// zones 模式启动诊断：为什么 waitForFunction 等不到 match.mode === 'zones'
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Google/Edge/Application/msedge.exe'].find(p=>existsSync(p))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio'] })
const page = await browser.newPage()
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0,200)))
page.on('console', m => { if (m.type()==='error') errs.push('[console] '+m.text().slice(0,160)) })
await page.goto('http://127.0.0.1:8490/?mode=zones&autostart=300&autopilot&shadercheck', { waitUntil: 'domcontentloaded', timeout: 180000 })
for (let i = 1; i <= 10; i++) {
  await new Promise(r => setTimeout(r, 12000))
  const st = await page.evaluate(`(() => {
    const W = window.__inkwave, m = W && W.match
    return JSON.stringify({
      hasW: !!W, hasM: !!m,
      mode: m ? m.mode : null,
      attract: m ? !!m.attract : null,
      state: m ? m.state : null,
      stateT: m ? +(m.stateT||0).toFixed(1) : null,
      zones: m ? !!m.zones : null,
      quiz: m ? !!m.quiz : null,
      actors: m ? m.actors.length : null,
      menu: W && W.menus ? W.menus.current : null,
    })
  })()`)
  console.log('t=' + (i*12) + 's ' + st)
  if (JSON.parse(st).mode === 'zones') { console.log('-> zones 已就绪'); break }
}
if (errs.length) console.log('\n错误:\n  ' + errs.slice(0,8).join('\n  '))
await browser.close()
