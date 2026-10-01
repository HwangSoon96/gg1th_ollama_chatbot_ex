// CDP로 직접 스크린샷. gjc browser 툴이 이 환경(WSL2)에서 기동 실패해서 대체용.
// 사용: node /tmp/shot.mjs <url> <out.png> [width] [height] [theme]
const [url, out, w = '1280', h = '800', theme = 'light'] = process.argv.slice(2)

const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json()
let page = targets.find((t) => t.type === 'page')
if (!page) {
  page = await (await fetch('http://127.0.0.1:9333/json/new?about:blank')).json()
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })

const events = new Map()
const waitEvent = (name) =>
  new Promise((resolve) => events.set(name, resolve))

ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
  }
  if (msg.method && events.has(msg.method)) {
    events.get(msg.method)()
    events.delete(msg.method)
  }
})

await new Promise((r) => ws.addEventListener('open', r))

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(w),
  height: Number(h),
  deviceScaleFactor: 2,
  mobile: Number(w) < 600,
})
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: theme }],
})

const loaded = waitEvent('Page.loadEventFired')
await send('Page.navigate', { url })
await loaded
await new Promise((r) => setTimeout(r, 600)) // 폰트·레이아웃 안정화

const { data } = await send('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync(out, Buffer.from(data, 'base64'))
console.log(`saved ${out} (${w}x${h}, ${theme})`)
ws.close()
process.exit(0)
