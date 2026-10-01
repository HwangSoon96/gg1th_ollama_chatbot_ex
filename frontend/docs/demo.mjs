/* 데모 영상 녹화. CDP 스크린캐스트로 프레임을 모아 ffmpeg로 mp4/gif를 만든다.
 *
 * shot.mjs와 같은 이유로 무의존성 CDP를 쓴다 — gjc browser 툴이 이 환경(WSL2)에서
 * 기동 실패하고, 데모 녹화는 일회성 작업이라 playwright를 프로젝트 의존성에 넣을 이유가 없다.
 *
 * 사용: node docs/demo.mjs [url] [outdir]
 * 필요: 백엔드(127.0.0.1:8000) + 프론트 dev 서버 + Ollama가 떠 있어야 한다.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const URL_ = process.argv[2] ?? 'http://127.0.0.1:5173/'
const OUTDIR = process.argv[3] ?? 'docs'
const PORT = 9334
const W = 1280
/* 720으로 녹화한다. 세로가 짧을수록 스크롤 오버플로가 일찍 생겨
 * "맨 아래로" 버튼 시나리오가 짧은 대화에서도 성립한다. 16:9도 덜 어쀑하다. */
const H = 720

const FRAMES = '/tmp/llmchat-demo-frames'

/* ── 브라우저 기동 ───────────────────────────────────────────── */

rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })

const chrome = spawn('google-chrome', [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--window-size=${W},${H}`,
  '--force-device-scale-factor=1',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  // 애니메이션을 실제 속도로 보여주려면 배경 탭 스로틀링이 없어야 한다
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 디버깅 엔드포인트가 열릴 때까지 기다린다. */
async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      /* 아직 안 떴다 */
    }
    await sleep(250)
  }
  throw new Error('크롬 디버깅 포트가 열리지 않았습니다')
}

const page = await target()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, j) => {
  ws.addEventListener('open', r)
  ws.addEventListener('error', () => j(new Error('CDP 연결 실패')))
})

/* ── CDP 배관 ───────────────────────────────────────────────── */

let msgId = 0
const pending = new Map()
const handlers = new Map()

ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    return
  }
  // shot.mjs의 단발 리스너와 달리 스크린캐스트는 같은 이벤트를 수백 번 받는다
  if (msg.method) for (const fn of handlers.get(msg.method) ?? []) fn(msg.params)
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

const on = (method, fn) => {
  if (!handlers.has(method)) handlers.set(method, [])
  handlers.get(method).push(fn)
}

/** 페이지 안에서 표현식을 평가하고 값을 받아온다. */
async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? '평가 실패')
  return result.value
}

/** 조건이 참이 될 때까지 기다린다. 고정 sleep으로 버티면 느린 날에 깨진다. */
async function waitFor(expression, { timeout = 120000, label = expression } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(`!!(${expression})`)) return
    await sleep(150)
  }
  throw new Error(`시간 초과: ${label}`)
}

/** 셀렉터의 화면 중심 좌표. 없으면 던진다 — 조용히 헛클릭하면 원인을 못 찾는다. */
async function center(selector, index = 0) {
  const box = await evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!box) throw new Error(`요소를 찾지 못했습니다: ${selector}[${index}]`)
  return box
}

/** 실제 마우스 이벤트로 누른다. hover 상태도 같이 보여야 데모가 자연스럽다. */
async function click(selector, index = 0, { settle = 450 } = {}) {
  const { x, y } = await center(selector, index)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sleep(220)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', clickCount: 1,
    })
    await sleep(60)
  }
  await sleep(settle)
}

/** 사람이 치는 것처럼 한 글자씩 넣는다. 한 번에 붙이면 영상에서 "순간이동"으로 보인다. */
async function type(text, delay = 55) {
  for (const ch of text) {
    await send('Input.insertText', { text: ch })
    await sleep(delay)
  }
}

async function wheel(deltaY, steps = 1) {
  const { x, y } = await center('.chat-window__viewport')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  for (let i = 0; i < steps; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX: 0, deltaY,
    })
    await sleep(90)
  }
}

/* ── 프레임 수집 ────────────────────────────────────────────── */

const frames = []

on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  // 디스크 쓰기는 녹화가 끝난 뒤에. 캡처 중에 쓰면 이벤트 루프가 밀려 프레임 간격이 흔들린다.
  frames.push({ buf: Buffer.from(data, 'base64'), t: metadata.timestamp })
  send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 1, mobile: false,
})

/* ── 준비: 깨끗한 상태 + 짧은 답변 ──────────────────────────── */

await send('Page.navigate', { url: URL_ })
await waitFor('document.querySelector(".composer__input")', { label: '앱 로드' })

/* 데모용 상태를 심는다. num_predict를 줄여 답변을 짧게 받는다 —
 * 기본 256으로는 한 번에 40초씩 걸려 영상이 늘어진다. */
await evaluate(`(() => {
  localStorage.removeItem('llmchat.v1.conversation')
  localStorage.setItem('llmchat.v1.theme', JSON.stringify('light'))
  localStorage.setItem('llmchat.v1.rail', JSON.stringify(true))
  localStorage.setItem('llmchat.v1.settings', JSON.stringify({
    model: 'exaone3.5:7.8b',
    systemPrompt:
      '너는 초보자를 돕는 친절한 AI 강사다. 핵심을 불릿 목록 3~5개로 정리하고, 필요하면 짧은 코드 예시를 붙인다.',
    temperature: 0.6, topP: 0.7, numPredict: 256, carryContext: true,
  }))
})()`)

await send('Page.reload')
await waitFor('document.querySelector(".empty__example")', { label: '빈 상태' })
await sleep(1200) // 폰트·레이아웃 안정화

/* ── 녹화 시작 ──────────────────────────────────────────────── */

await send('Page.startScreencast', {
  format: 'jpeg', quality: 75, maxWidth: W, maxHeight: H, everyNthFrame: 1,
})
await sleep(1400) // 빈 상태를 잠깐 보여준다

/** 지금 얼마나 스크롤할 수 있는가. 이게 0이면 "맨 아래로"는 원래 안 나온다. */
const scrollable = () => evaluate(`(() => {
  const el = document.querySelector('.chat-window__viewport')
  return el ? el.scrollHeight - el.clientHeight : 0
})()`)

/** 답변이 도착할 때까지. 대기 인디케이터를 충분히 보여준다. */
async function awaitAnswer(hold = 2400) {
  await waitFor('document.querySelector(".pending")', {
    timeout: 15000, label: '대기 표시',
  })
  await sleep(hold) // 경과 초가 올라가는 걸 보여준다
  await waitFor('!document.querySelector(".pending")', { label: '답변 도착' })
  await sleep(1500)
}

/** 질문을 직접 치고 Enter로 보람다. */
async function ask(question) {
  await click('.composer__input', 0, { settle: 250 })
  await type(question)
  await sleep(500)
  for (const type_ of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type: type_, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    })
  }
  await awaitAnswer()
}

// 1. 예시를 늘러 입력창을 채우고 전송
await click('.empty__example', 0, { settle: 900 })
await click('.composer__send', 0, { settle: 400 })
await awaitAnswer(2600)

// 2. 두 번째 질문은 직접 타이핑한다 (한글 IME 없이 insertText)
await ask('토플은 언제 쓰는 게 좋아?')

/* 3. 스크롤 데모는 오버플로가 있어야 성립한다.
 * 모델 답변 길이는 매번 달라지므로 모자라면 질문을 하나 더 한다.
 * 고정 시나리오로 박아두면 짧게 답한 날에 녹화가 통짜로 실패한다. */
const NEED = 240 // BOTTOM_SLACK(64) * 3보다 충분히 큼
if ((await scrollable()) < NEED) {
  await ask('리스트 쯤프리헨션도 알려줘')
}

const room = await scrollable()
if (room < NEED) {
  console.warn(`경고: 스크롤 여지가 ${room}px라 버튼 데모를 건넌다니다`)
} else {
  // 4. 위로 굴려 "맨 아래로" 버튼을 띄운다
  await wheel(-320, 6)
  await sleep(1300)
  await waitFor('document.querySelector(".chat-window__jump")', {
    timeout: 5000, label: '맨 아래로 버튼',
  })
  await sleep(900)
  // 5. 버튼으로 복귀
  await click('.chat-window__jump', 0, { settle: 1400 })
}

// 6. 다킬 모드
await click('.theme-toggle', 0, { settle: 1800 })

// 7. 대화 비우기 — 인라인 확인을 거친다
await click('.clear', 0, { settle: 1000 })
await click('.clear__yes', 0, { settle: 500 })
await waitFor('document.querySelector(".empty__example")', {
  timeout: 5000, label: '빈 상태 복귀',
})
// 비운 뒤 "맨 아래로"가 남지 않는지 — 방금 고친 부분이다
const leftover = await evaluate('!!document.querySelector(".chat-window__jump")')
await sleep(1800)

await send('Page.stopScreencast')
ws.close()
chrome.kill()

if (leftover) console.warn('경고: 대화를 비운 뒤에도 맨 아래로 버튼이 남아 있습니다')
if (frames.length < 30) throw new Error(`프레임이 너무 적습니다 (${frames.length})`)

/* ── 인코딩 ─────────────────────────────────────────────────── */

/* 스크린캐스트 프레임은 일정 간격으로 오지 않는다(변화가 없으면 아예 안 온다).
 * 그래서 고정 fps로 붙이면 타이밍이 어긋난다 — 프레임마다 실제 지속 시간을 준다. */
const lines = ['ffconcat version 1.0']
frames.forEach((f, i) => {
  const name = `f${String(i).padStart(5, '0')}.jpg`
  writeFileSync(join(FRAMES, name), f.buf)
  const dur = i < frames.length - 1
    ? Math.min(Math.max(frames[i + 1].t - f.t, 0.016), 0.5)
    : 0.05
  lines.push(`file ${name}`, `duration ${dur.toFixed(4)}`)
})
// concat demuxer는 마지막 파일의 duration을 무시한다. 한 번 더 적어 끝 프레임을 살린다.
lines.push(`file f${String(frames.length - 1).padStart(5, '0')}.jpg`)
writeFileSync(join(FRAMES, 'list.txt'), lines.join('\n'))

const total = frames.at(-1).t - frames[0].t
console.log(`프레임 ${frames.length}개, ${total.toFixed(1)}초`)

const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      stdio: 'inherit',
    })
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg 실패 (${code})`)),
    )
  })

const mp4 = join(OUTDIR, 'demo.mp4')
const gif = join(OUTDIR, 'demo.gif')
const palette = '/tmp/llmchat-demo-palette.png'
const input = ['-f', 'concat', '-safe', '0', '-i', join(FRAMES, 'list.txt')]

// mp4: 실제 속도. yuv420p + even 크기가 아니면 못 재생하는 플레이어가 있다
await run([...input, '-vsync', 'vfr', '-c:v', 'libx264', '-preset', 'slow',
  '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4])

/* gif: README에 붙일 용도라 3배속 + 12fps + 720px로 줄인다.
 * 팔레트를 따로 뽑지 않으면 코드 글자와 앰버 강조색이 뭉갠다. */
const vf = 'setpts=PTS/3,fps=12,scale=720:-1:flags=lanczos'
await run([...input, '-vf', `${vf},palettegen=stats_mode=diff`, palette])
await run([...input, '-i', palette, '-lavfi',
  `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, gif])

console.log(`완료: ${mp4}, ${gif}`)
