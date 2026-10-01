import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import MessageList from './MessageList'
import './ChatWindow.css'

/* 스크롤 컨테이너 (PRD 4.1-8).
 *
 * "새 메시지가 오면 맨 아래로" — 단, 사용자가 위로 올려 읽는 중이면 안 된다.
 * 40초짜리 답변을 기다리는 동안 과거 대화를 읽는 건 흔한 일이고,
 * 그때 화면을 끌어내리면 읽던 자리를 잃는다.
 *
 * 그래서 "바닥 근처에 있었는가"를 기억한다. 있었으면 따라가고, 아니면 가만히 둔다.
 */

/* 바닥 판정 여유. 0이면 소수점 오차나 관성 스크롤에서 어긋난다. */
const BOTTOM_SLACK = 64

/** 마지막 메시지가 끝난 AI 답변인가(대기 중이 아니고, 오류도 도착은 도착이다). */
function lastAnswerId(messages) {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant' || last.status === 'pending') return null
  return last.id
}

export default function ChatWindow({ messages, onRetry, canRetry, onPickExample, model }) {
  const viewportRef = useRef(null)
  const atBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  /* 위로 올려 읽는 동안 답변이 도착하면 화면에는 아무 일도 안 일어난다.
   * 대기 표시는 저 아래에 있고, 스크롤은 일부러 안 건드리므로(그게 맞다)
   * 사용자는 내려가 보기 전까지 답이 왔는지 알 수 없다.
   * 그래서 "안 본 답변"을 따로 기억해 버튼이 그 사실을 말하게 한다.
   *
   * boolean이 아니라 답변 id를 들고 있는다 — 그 답변이 목록에서 사라지면
   * (대화 버리기) 알림도 자연히 사라진다. 별도로 지우지 않아도 어긋나지 않는다. */
  const [unseenId, setUnseenId] = useState(null)
  const lastSeenRef = useRef(lastAnswerId(messages))

  const unseen = unseenId !== null && messages.some((m) => m.id === unseenId)

  /* 빈 상태↔목록 전환이 일어나면 스크롤 영역의 자식 요소가 통째로 바뀜다.
   * 크기 관찰을 다시 붙여야 하는 유일한 시점이다. */
  const isEmpty = messages.length === 0

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    atBottomRef.current = true
    setShowJump(false)
    setUnseenId(null)
  }, [])

  /* 버튼 상태를 실제 스크롤 위치에서 다시 읽는다.
   *
   * scroll 이벤트만 믿으면 안 된다 — 대화를 비우면 스크롤할 내용 자체가 사라져
   * 브라우저가 scrollTop을 0으로 끌어내리면서도 이벤트를 주지 않는 경우가 있다.
   * 그러면 버튼은 "위로 올라가 있던" 상태로 빈 화면에 남는다. */
  const measure = useCallback(() => {
    const el = viewportRef.current
    if (!el) return

    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance <= BOTTOM_SLACK
    atBottomRef.current = atBottom
    // 위로 올라가 있을 때만 "맨 아래로" 버튼을 준다
    setShowJump(distance > BOTTOM_SLACK * 3)
    // 직접 내려가서 봤으면 알림은 역할을 다했다
    if (atBottom) setUnseenId(null)
  }, [])

  /* 대기 중이던 답변이 끝난 순간을 잡는다.
   * 바닥에 있었으면 이미 따라갔을 테니 알릴 일이 없다. */
  useEffect(() => {
    const id = lastAnswerId(messages)
    if (id === null || id === lastSeenRef.current) return

    lastSeenRef.current = id
    if (!atBottomRef.current) setUnseenId(id)
  }, [messages])

  /* 메시지가 바뀐 직후, 페인트 전에 맞춘다.
   * useEffect로 두면 한 프레임 어긋난 위치가 보인다. */
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
    // 목록이 짧아져 더 이상 올라갈 곳이 없어졌을 수도 있다
    measure()
  }, [messages, measure])

  /* 답변이 길면 생성 직후 높이가 크게 늨다.
   * 대기 표시의 경과 초도 계속 바뀌고, 폰트·이미지 로딩으로 나중에 또 늘어난다.
   * messages 배열이 바뀌는 순간만으로는 이걸 다 잡을 수 없다.
   *
   * 관찰 대상을 마운트 시점에 고정하면 안 된다 — 그때 firstElementChild는
   * 빈 상태 div고, 메시지가 생기면 그 요소는 사라져서 옥서버가 떨어진 노드를 본다.
   * 내용물이 바뀔 때마다 다시 붙인다. */
  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const target = el.firstElementChild
    if (!target) return

    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight
      measure()
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [isEmpty, measure])

  return (
    <div className="chat-window">
      <div
        className="chat-window__viewport"
        ref={viewportRef}
        onScroll={measure}
        tabIndex={0}
        role="log"
        aria-label="대화 내역"
      >
        <MessageList
          messages={messages}
          onRetry={onRetry}
          canRetry={canRetry}
          onPickExample={onPickExample}
          model={model}
        />
      </div>

      {/* 안 본 답변이 있으면 스크롤을 조금만 올렸어도 버튼을 띄운다.
          빈 화면에는 내려갈 곳이 없으므로 무조건 감춘다 */}
      {!isEmpty && (showJump || unseen) && (
        <button
          type="button"
          className={`chat-window__jump ${unseen ? 'chat-window__jump--new' : ''}`}
          onClick={() => scrollToBottom()}
        >
          {unseen ? (
            <>
              <span className="chat-window__jump-dot" aria-hidden="true" />
              새 답변 도착
            </>
          ) : (
            '↓ 맨 아래로'
          )}
        </button>
      )}
    </div>
  )
}
