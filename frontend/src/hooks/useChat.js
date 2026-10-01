import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sendChatMessage } from '../api/chatApi'
import { buildChatMessage } from '../lib/conversation'
import { clearConversation, loadConversation, saveConversation } from '../lib/storage'
import { toRequestParams } from './useSettings'

/* 메시지 상태와 전송 흐름.
 *
 * 백엔드는 스트리밍을 하지 않는다. 요청 하나 = 답변 하나가 통째로 온다.
 * 그래서 "보내는 중"을 화면에 세워두는 일이 이 훅의 절반이다:
 * 사용자 말풍선은 즉시 올리고(낙관적 렌더링), 답변 자리에는 pending 말풍선을 미리 놓는다.
 *
 * 실패해도 사용자가 친 문장은 대화에 남는다. 재시도는 그 문장을 다시 쓴다(PRD 4.5-31,32).
 */

function newId() {
  // jsdom/구형 환경에 randomUUID가 없을 수 있다
  return globalThis.crypto?.randomUUID?.() ?? `m${Date.now()}${Math.random()}`
}

export function useChat(settings) {
  const [messages, setMessages] = useState(() => loadConversation())
  const abortRef = useRef(null)

  /* 전송 시점의 최신 목록이 필요하다.
   * setMessages 업데이터 안에서 읽으면 안 된다 — StrictMode는 업데이터를 두 번 호출하고,
   * 거기서 요청을 띄우면 같은 질문이 두 번 나간다. */
  const messagesRef = useRef(messages)

  // 전송 시점의 최신 설정을 쓴다. 콜백을 매번 새로 만들지 않기 위해 ref로 둔다.
  // 렌더 중에 쓰면 안 된다(react-hooks/refs) — 커밋 후에 맞춘다.
  // send/retry는 사용자 이벤트에서만 불리므로 항상 커밋 이후다.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    messagesRef.current = messages
    saveConversation(messages)
  }, [messages])

  // pending 말풍선의 존재가 곧 "요청 중"이다. 별도 상태를 두면 어긋날 수 있다.
  const pending = useMemo(
    () => messages.find((m) => m.status === 'pending') ?? null,
    [messages],
  )
  const isSending = pending !== null

  const run = useCallback(async (prompt, history) => {
    const settings = settingsRef.current
    const answerId = newId()

    const userMessage = {
      id: newId(),
      role: 'user',
      content: prompt,
      status: 'done',
    }
    const placeholder = {
      id: answerId,
      role: 'assistant',
      content: '',
      status: 'pending',
      model: settings.model,
      startedAt: Date.now(),
    }

    setMessages([...history, userMessage, placeholder])

    messagesRef.current = [...history, userMessage, placeholder]

    const controller = new AbortController()
    abortRef.current = controller

    const patch = (fields) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === answerId ? { ...m, ...fields } : m)),
      )

    try {
      const answer = await sendChatMessage(
        {
          message: buildChatMessage(history, prompt, {
            carryContext: settings.carryContext,
          }),
          ...toRequestParams(settings),
        },
        controller.signal,
      )

      patch({
        status: 'done',
        content: answer.message,
        model: answer.model,
        elapsedTime: answer.elapsedTime,
        startedAt: undefined,
      })
    } catch (err) {
      // 오류 문구는 chatApi가 "원인 + 다음 행동"으로 이미 만들어 둔다
      patch({
        status: 'error',
        content: err?.message ?? '알 수 없는 오류가 발생했습니다.',
        kind: err?.kind ?? 'unknown',
        startedAt: undefined,
      })
    } finally {
      abortRef.current = null
    }
  }, [])

  const send = useCallback(
    (text) => {
      const prompt = (text ?? '').trim()
      if (!prompt || abortRef.current) return false

      run(prompt, messagesRef.current)
      return true
    },
    [run],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /* 재시도는 마지막 교환에만 허용한다.
   * 중간에 실패한 답변을 다시 부르면 그 뒤의 대화와 순서가 엉킨다. */
  const canRetry = useMemo(() => {
    const last = messages.at(-1)
    const prev = messages.at(-2)
    return (
      !isSending &&
      last?.role === 'assistant' &&
      last?.status === 'error' &&
      prev?.role === 'user'
    )
  }, [messages, isSending])

  const retry = useCallback(() => {
    if (abortRef.current) return

    const current = messagesRef.current
    const last = current.at(-1)
    const question = current.at(-2)
    if (
      last?.role !== 'assistant' ||
      last?.status !== 'error' ||
      question?.role !== 'user'
    ) {
      return
    }

    // 실패한 교환(질문+오류)을 걷어내고 같은 질문을 다시 보낸다
    run(question.content, current.slice(0, -2))
  }, [run])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    messagesRef.current = []
    setMessages([])
    clearConversation()
  }, [])

  return { messages, isSending, pending, send, cancel, retry, canRetry, clear }
}
