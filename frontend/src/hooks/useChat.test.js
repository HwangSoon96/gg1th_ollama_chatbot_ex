// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONVERSATION_KEY } from '../lib/storage'
import { useChat } from './useChat'
import { DEFAULTS } from './useSettings'

vi.mock('../api/chatApi', () => ({
  sendChatMessage: vi.fn(),
}))

const { sendChatMessage } = await import('../api/chatApi')

/** 응답 시점을 테스트가 직접 잡는다. 대기 중 화면을 검사하려면 필요하다. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const answer = (message, extra = {}) => ({
  model: DEFAULTS.model,
  message,
  elapsedTime: 1.5,
  ...extra,
})

function chatError(kind, message) {
  const err = new Error(message)
  err.name = 'ChatError'
  err.kind = kind
  return err
}

const setup = (settings = DEFAULTS) => renderHook(() => useChat(settings))

/** send는 fire-and-forget이라 마이크로태스크를 한 번 흘려보내야 결과가 보인다. */
const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  localStorage.clear()
  vi.mocked(sendChatMessage).mockReset()
})

describe('전송', () => {
  it('사용자 말풍선을 즉시 올리고 답변 자리를 잡아둔다', async () => {
    // 백엔드는 스트리밍을 안 한다. 대기 중 화면이 비면 멈춘 것처럼 보인다.
    const d = deferred()
    vi.mocked(sendChatMessage).mockReturnValue(d.promise)

    const { result } = setup()
    act(() => { result.current.send('안녕') })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: '안녕' })
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', status: 'pending' })
    expect(result.current.isSending).toBe(true)

    await act(async () => { d.resolve(answer('안녕하세요')) })
  })

  it('pending 말풍선에 경과 시간 기준점을 남긴다', async () => {
    const d = deferred()
    vi.mocked(sendChatMessage).mockReturnValue(d.promise)

    const { result } = setup()
    act(() => { result.current.send('안녕') })

    // 4.6의 "경과 시간" 표시가 이 값에 걸린다
    expect(result.current.pending.startedAt).toBeTypeOf('number')

    await act(async () => { d.resolve(answer('안녕하세요')) })
  })

  it('응답이 오면 답변과 메타를 채운다', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(
      answer('안녕하세요', { model: 'qwen3.5:9b', elapsedTime: 2.7 }),
    )

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })

    const last = result.current.messages.at(-1)
    expect(last).toMatchObject({
      role: 'assistant',
      status: 'done',
      content: '안녕하세요',
      model: 'qwen3.5:9b',
      elapsedTime: 2.7,
    })
    expect(last.startedAt).toBeUndefined()
    expect(result.current.isSending).toBe(false)
  })

  it('앞뒤 공백만 있는 입력은 보내지 않는다', () => {
    const { result } = setup()

    let accepted
    act(() => { accepted = result.current.send('   ') })

    expect(accepted).toBe(false)
    expect(sendChatMessage).not.toHaveBeenCalled()
    expect(result.current.messages).toHaveLength(0)
  })

  it('보내는 중에 또 보내도 요청은 하나만 나간다', async () => {
    /* StrictMode는 상태 업데이터를 두 번 호출한다.
     * 거기서 요청을 띄우면 같은 질문이 두 번 나간다. */
    const d = deferred()
    vi.mocked(sendChatMessage).mockReturnValue(d.promise)

    const { result } = setup()
    act(() => { result.current.send('첫 질문') })

    let accepted
    act(() => { accepted = result.current.send('두 번째 질문') })

    expect(accepted).toBe(false)
    expect(sendChatMessage).toHaveBeenCalledTimes(1)

    await act(async () => { d.resolve(answer('답변')) })
  })

  it('현재 설정을 요청에 싣는다', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(answer('답변'))

    const { result } = setup({ ...DEFAULTS, model: 'qwen3.5:9b', temperature: 1.1 })
    await act(async () => { result.current.send('안녕') })

    expect(sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '안녕',
        model: 'qwen3.5:9b',
        temperature: 1.1,
        top_p: DEFAULTS.topP,
        num_predict: DEFAULTS.numPredict,
      }),
      expect.any(AbortSignal),
    )
  })
})

describe('맥락 이어가기', () => {
  it('토글이 켜져 있으면 이전 대화를 접어 보낸다', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(answer('첫 답변'))

    const { result } = setup()
    await act(async () => { result.current.send('첫 질문') })

    vi.mocked(sendChatMessage).mockResolvedValue(answer('둘째 답변'))
    await act(async () => { result.current.send('둘째 질문') })

    const sent = vi.mocked(sendChatMessage).mock.calls.at(-1)[0].message
    expect(sent).toContain('첫 질문')
    expect(sent).toContain('첫 답변')
    expect(sent).toContain('둘째 질문')
  })

  it('토글이 꺼져 있으면 사용자가 친 문장만 나간다', async () => {
    // 몰래 덧붙이지 않는다 (PRD 4.2-13)
    vi.mocked(sendChatMessage).mockResolvedValue(answer('첫 답변'))

    const { result, rerender } = renderHook(({ s }) => useChat(s), {
      initialProps: { s: DEFAULTS },
    })
    await act(async () => { result.current.send('첫 질문') })

    rerender({ s: { ...DEFAULTS, carryContext: false } })

    vi.mocked(sendChatMessage).mockResolvedValue(answer('둘째 답변'))
    await act(async () => { result.current.send('둘째 질문') })

    expect(vi.mocked(sendChatMessage).mock.calls.at(-1)[0].message).toBe('둘째 질문')
  })
})

describe('오류', () => {
  it('실패해도 사용자가 친 문장은 대화에 남는다', async () => {
    // PRD 4.5-32: 오류가 나도 입력한 내용을 잃지 않아야 한다
    vi.mocked(sendChatMessage).mockRejectedValue(
      chatError('offline', '백엔드에 연결할 수 없습니다.'),
    )

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })

    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: '안녕' })
    expect(result.current.messages.at(-1)).toMatchObject({
      status: 'error',
      kind: 'offline',
      content: '백엔드에 연결할 수 없습니다.',
    })
  })

  it('실패 후에도 다시 보낼 수 있다 (요청 잠금이 풀린다)', async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(chatError('server', '500'))

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })

    expect(result.current.isSending).toBe(false)

    vi.mocked(sendChatMessage).mockResolvedValue(answer('이번엔 성공'))
    await act(async () => { result.current.send('다시') })

    expect(result.current.messages.at(-1).content).toBe('이번엔 성공')
  })

  it('kind가 없는 예외도 화면에 말이 되게 남는다', async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(new Error('알 수 없음'))

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })

    expect(result.current.messages.at(-1)).toMatchObject({
      status: 'error',
      kind: 'unknown',
    })
  })
})

describe('취소', () => {
  it('취소하면 요청이 중단되고 취소 상태로 남는다', async () => {
    vi.mocked(sendChatMessage).mockImplementation(
      (_payload, signal) =>
        new Promise((_res, rej) => {
          signal.addEventListener('abort', () =>
            rej(chatError('canceled', '요청을 취소했습니다.')),
          )
        }),
    )

    const { result } = setup()
    act(() => { result.current.send('안녕') })

    expect(result.current.isSending).toBe(true)

    await act(async () => { result.current.cancel() })

    expect(result.current.isSending).toBe(false)
    expect(result.current.messages.at(-1)).toMatchObject({
      status: 'error',
      kind: 'canceled',
    })
  })

  it('보내는 중이 아닐 때 취소해도 아무 일도 없다', () => {
    const { result } = setup()

    expect(() => act(() => result.current.cancel())).not.toThrow()
    expect(result.current.messages).toHaveLength(0)
  })
})

describe('재시도', () => {
  it('마지막 교환이 실패했을 때만 재시도할 수 있다', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(answer('답변'))

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })

    expect(result.current.canRetry).toBe(false)

    vi.mocked(sendChatMessage).mockRejectedValue(chatError('server', '500'))
    await act(async () => { result.current.send('두 번째') })

    expect(result.current.canRetry).toBe(true)
  })

  it('재시도는 실패한 교환을 걷어내고 같은 질문을 다시 보낸다', async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(chatError('server', '500'))

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })
    expect(result.current.messages).toHaveLength(2)

    vi.mocked(sendChatMessage).mockResolvedValue(answer('이번엔 성공'))
    await act(async () => { result.current.retry() })

    // 질문 + 답변 하나씩. 실패한 말풍선이 쌓이지 않는다.
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: '안녕' })
    expect(result.current.messages[1]).toMatchObject({
      status: 'done',
      content: '이번엔 성공',
    })
  })

  it('재시도한 질문은 맥락에 중복으로 들어가지 않는다', async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(chatError('server', '500'))

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })

    vi.mocked(sendChatMessage).mockResolvedValue(answer('성공'))
    await act(async () => { result.current.retry() })

    const sent = vi.mocked(sendChatMessage).mock.calls.at(-1)[0].message
    expect(sent).toBe('안녕')
  })

  it('성공한 대화는 재시도하지 않는다', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(answer('답변'))

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })

    await act(async () => { result.current.retry() })

    expect(sendChatMessage).toHaveBeenCalledTimes(1)
  })

  it('보내는 중에는 재시도가 먹지 않는다', async () => {
    const d = deferred()
    vi.mocked(sendChatMessage).mockReturnValue(d.promise)

    const { result } = setup()
    act(() => { result.current.send('안녕') })

    act(() => { result.current.retry() })

    expect(sendChatMessage).toHaveBeenCalledTimes(1)
    expect(result.current.canRetry).toBe(false)

    await act(async () => { d.resolve(answer('답변')) })
  })
})

describe('지속성', () => {
  it('대화를 localStorage에 저장한다', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(answer('안녕하세요'))

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(CONVERSATION_KEY))
      expect(saved).toHaveLength(2)
      expect(saved[1].content).toBe('안녕하세요')
    })
  })

  it('저장된 대화를 복원한다', () => {
    localStorage.setItem(
      CONVERSATION_KEY,
      JSON.stringify([
        { id: '1', role: 'user', content: '지난 질문', status: 'done' },
        { id: '2', role: 'assistant', content: '지난 답변', status: 'done' },
      ]),
    )

    const { result } = setup()

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0].content).toBe('지난 질문')
  })

  it('대화 초기화는 화면과 저장본을 함께 비운다', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(answer('답변'))

    const { result } = setup()
    await act(async () => { result.current.send('안녕') })

    act(() => { result.current.clear() })
    await flush()

    expect(result.current.messages).toEqual([])
    expect(localStorage.getItem(CONVERSATION_KEY)).toBeNull()
  })

  it('보내는 중에 초기화하면 요청도 함께 끊는다', async () => {
    // 끊지 않으면 비운 화면에 답변이 뒤늦게 날아와 붙는다
    let captured
    vi.mocked(sendChatMessage).mockImplementation(
      (_payload, signal) =>
        new Promise((_res, rej) => {
          captured = signal
          signal.addEventListener('abort', () => rej(chatError('canceled', '취소')))
        }),
    )

    const { result } = setup()
    act(() => { result.current.send('안녕') })

    await act(async () => { result.current.clear() })

    expect(captured.aborted).toBe(true)
    expect(result.current.messages).toEqual([])
  })
})
