import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatError, fetchModels, isChatModel, sendChatMessage } from './chatApi'

const PAYLOAD = { message: '안녕', model: 'exaone3.5:7.8b' }

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendChatMessage', () => {
  it('백엔드 응답을 카멜케이스로 정규화한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          model: 'exaone3.5:7.8b',
          message: '안녕하세요',
          elapsed_time: 1.23,
        }),
      ),
    )

    await expect(sendChatMessage(PAYLOAD)).resolves.toEqual({
      model: 'exaone3.5:7.8b',
      message: '안녕하세요',
      elapsedTime: 1.23,
    })
  })

  it('서버에 닿지 못하면 offline으로 분류하고 실행 방법을 알려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )

    const err = await sendChatMessage(PAYLOAD).catch((e) => e)
    expect(err).toBeInstanceOf(ChatError)
    expect(err.kind).toBe('offline')
    expect(err.message).toContain('uv run main.py')
  })

  it('500 응답이면 백엔드가 준 detail을 그대로 보여준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ detail: '모델을 찾을 수 없습니다' }, 500),
      ),
    )

    const err = await sendChatMessage(PAYLOAD).catch((e) => e)
    expect(err.kind).toBe('server')
    expect(err.message).toContain('모델을 찾을 수 없습니다')
  })

  it('detail이 없는 오류 응답도 상태 코드로 설명한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 500 })),
    )

    const err = await sendChatMessage(PAYLOAD).catch((e) => e)
    expect(err.kind).toBe('server')
    expect(err.message).toContain('500')
  })

  it.each([502, 503, 504])(
    '%d는 프록시가 백엔드에 못 닿은 것이므로 offline으로 분류한다',
    async (status) => {
      /* 개발 중에는 vite 프록시(/api)가 백엔드가 꺼져 있을 때 502를 준다.
       * 이걸 server로 두면 "백엔드가 502 오류를 반환했습니다"만 떠서
       * 사용자가 무엇을 해야 하는지 알 수 없다(PRD 4.5-30). */
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('Bad Gateway', { status })),
      )

      const err = await sendChatMessage(PAYLOAD).catch((e) => e)
      expect(err.kind).toBe('offline')
      expect(err.message).toContain('uv run main.py')
    },
  )

  it('사용자가 취소하면 timeout이 아니라 canceled로 구분한다', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url, { signal }) => {
        controller.abort()
        return Promise.reject(
          Object.assign(new Error('aborted'), {
            name: 'AbortError',
            cause: signal.reason,
          }),
        )
      }),
    )

    const err = await sendChatMessage(PAYLOAD, controller.signal).catch((e) => e)
    expect(err.kind).toBe('canceled')
  })

  it('시간이 초과되면 timeout으로 분류한다', async () => {
    // 실제 120초를 기다릴 수 없으니 타임아웃 시그널만 짧게 바꾼다.
    // 시그널 자체는 진짜라서 분기 로직은 실제 경로를 탄다.
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.timeout(20))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              ),
            )
          }),
      ),
    )

    const err = await sendChatMessage(PAYLOAD).catch((e) => e)
    expect(err.kind).toBe('timeout')
    expect(err.message).toContain('120초')
  })

  it('취소되지 않은 시그널이 있어도 시간 초과는 timeout으로 남는다', async () => {
    // userSignal이 붙어 있다는 이유만으로 canceled로 잘못 분류하면 안 된다
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.timeout(20))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              ),
            )
          }),
      ),
    )

    const err = await sendChatMessage(PAYLOAD, controller.signal).catch((e) => e)
    expect(err.kind).toBe('timeout')
  })

  it('취소와 타임아웃이 동시에 발동하면 취소가 이긴다', async () => {
    // 사용자는 자기가 중단 버튼을 누른 걸 안다.
    // 그 순간 타임아웃도 같이 끝났다고 "시간 초과"라고 말하면 거짓말이다.
    // 둘 다 aborted인 상태를 만들어 우선순위를 직접 검증한다.
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.timeout(10))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              controller.abort() // 타임아웃 직후 사용자도 취소 → 둘 다 aborted
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              )
            })
          }),
      ),
    )

    const err = await sendChatMessage(PAYLOAD, controller.signal).catch((e) => e)
    expect(err.kind).toBe('canceled')
  })

  it('message 필드가 없으면 malformed로 막는다', async () => {
    // 백엔드 계약이 바뀌거나 다른 서버에 붙었을 때 조용히 빈 답변을 띄우지 않게 한다
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ model: 'x', ai_message: '?' })),
    )

    const err = await sendChatMessage(PAYLOAD).catch((e) => e)
    expect(err.kind).toBe('malformed')
  })

  it('JSON이 아닌 응답도 malformed로 막는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })),
    )

    const err = await sendChatMessage(PAYLOAD).catch((e) => e)
    expect(err.kind).toBe('malformed')
  })
})

describe('fetchModels', () => {
  it('임베딩 전용 모델을 목록에서 제외한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          models: [
            'exaone3.5:7.8b',
            'bge-m3:latest',
            'qwen3.5:9b',
            'nomic-embed-text:latest',
          ],
        }),
      ),
    )

    await expect(fetchModels()).resolves.toEqual([
      'exaone3.5:7.8b',
      'qwen3.5:9b',
    ])
  })

  it('models 필드가 깨져 있어도 빈 배열을 준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))
    await expect(fetchModels()).resolves.toEqual([])
  })
})

describe('isChatModel', () => {
  it('실제 설치된 모델을 올바르게 분류한다', () => {
    // 이 머신에 실제로 깔린 목록
    expect(isChatModel('exaone3.5:7.8b')).toBe(true)
    expect(isChatModel('qwen3.5:9b')).toBe(true)
    expect(isChatModel('gemma4:e2b')).toBe(true)
    expect(isChatModel('sageuk-qwen:latest')).toBe(true)
    expect(isChatModel('bge-m3:latest')).toBe(false)
  })
})
