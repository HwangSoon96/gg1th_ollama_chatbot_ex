import { useState } from 'react'
import { writeClipboard } from '../lib/clipboard'
import MessageContent from './MessageContent'
import PendingIndicator from './PendingIndicator'
import './MessageBubble.css'

/* 메시지 한 개 (PRD 4.4-23, 24, 25 / 4.5-29~31).
 *
 * 사용자 말풍선과 AI 답변은 모양을 다르게 준다. 사용자는 짧고 오른쪽,
 * AI는 길고 왼쪽 전체 폭 — 색만 다른 같은 말풍선 두 개는 긴 답변에서 읽기 나쁘다.
 */

/** 0.82 → "0.8초". 소수점 한 자리면 충분하고, 그 이상은 노이즈다. */
function formatElapsed(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return `${seconds.toFixed(1)}초`
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    const ok = await writeClipboard(text)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      className={`bubble__action ${copied ? 'bubble__action--done' : ''}`}
      onClick={copy}
    >
      {copied ? '복사됨' : '복사'}
    </button>
  )
}

export default function MessageBubble({ message, onRetry, canRetry }) {
  const { role, content, status, model, elapsedTime, kind, startedAt } = message
  const isUser = role === 'user'

  /* 대기하던 말풍선이 답변으로 바뀌는 순간을 잡는다.
   * id가 같아서 목록 쪽 등장 애니메이션은 터지지 않는다 — 여기서 따로 다룬다.
   * 초기화 함수는 첫 렌더에만 실행되므로 "대기로 시작했는가"가 남는다.
   * 복원된 답변(처음부터 done)은 해당 없다. */
  const [startedPending] = useState(status === 'pending')
  // 오류도 기다림의 끝이다. 둘 다 같은 등장을 준다.
  const justAnswered = startedPending && status !== 'pending'

  if (status === 'pending') {
    return (
      <article className="bubble bubble--assistant">
        <PendingIndicator model={model} startedAt={startedAt} />
      </article>
    )
  }

  if (status === 'error') {
    return (
      // 오류도 "기다리던 것이 끝난 순간"이다. 답변과 같은 등장을 준다
      <article
        className={`bubble bubble--assistant bubble--error ${
          justAnswered ? 'bubble--arrived' : ''
        }`}
        role="alert"
      >
        {/* 오류 문구에도 명령어가 들어 있다(`uv run main.py`).
            그냥 텍스트로 넣으면 백틱이 글자 그대로 노출된다. */}
        <div className="bubble__error-text">
          <MessageContent content={content} />
        </div>
        {/* 취소는 사용자가 의도한 일이다. 실패처럼 재시도를 권하지 않는다 */}
        {canRetry && kind !== 'canceled' && (
          <button type="button" className="bubble__retry" onClick={onRetry}>
            다시 시도
          </button>
        )}
      </article>
    )
  }

  const elapsed = formatElapsed(elapsedTime)

  return (
    <article
      className={`bubble ${isUser ? 'bubble--user' : 'bubble--assistant'} ${
        justAnswered ? 'bubble--arrived' : ''
      }`}
    >
      <MessageContent content={content} />

      {!isUser && (
        <footer className="bubble__meta">
          {model && <span className="bubble__model">{model}</span>}
          {elapsed && <span className="bubble__time tnum">{elapsed}</span>}
          <CopyButton text={content} />
        </footer>
      )}
    </article>
  )
}
