import { useState } from 'react'
import MessageBubble from './MessageBubble'
import './MessageList.css'

/* 메시지 목록 (PRD 4.4-28, 4.7-37).
 *
 * 빈 화면은 "고장"처럼 보인다. 무엇을 할 수 있는지 보여주고,
 * 예시를 누르면 바로 시작되게 한다.
 */

const EXAMPLES = [
  '파이썬 리스트와 튜플의 차이를 알려줘',
  'FastAPI로 GET 엔드포인트 만드는 법',
  '이 에러가 무슨 뜻이야? KeyError: 0',
]

function EmptyState({ onPick, model }) {
  return (
    <div className="empty">
      <h2 className="empty__title">
        무엇이든 물어보세요<span className="empty__caret" aria-hidden="true">_</span>
      </h2>

      {/* 모델명 뒤에 조사를 붙이지 않는다 — 끝소리를 알 수 없어
          "이/가"를 고를 수 없다. "모델"을 끼워 그 문제를 피한다. */}
      {model && (
        <p className="empty__sub">
          <code className="empty__model">{model}</code> 모델이 로컬에서 동작합니다.
        </p>
      )}

      {/* 한 줄을 넘기면 짧은 문구로 바꿈. CSS로는 길이를 재지 못하므로
          긴 쪼을 먼저 두고 좁아지면 짧은 쪽으로 교체한다 */}
      <p className="empty__privacy">
        <span className="empty__privacy-long">
          이 대화는 기기 안에서만 처리되며 외부 서버로 전송되지 않습니다.
        </span>
        <span className="empty__privacy-short">
          이 대화는 외부 서버로 전송되지 않습니다.
        </span>
      </p>

      <ul className="empty__examples">
        {EXAMPLES.map((example, i) => (
          <li key={example}>
            <button
              type="button"
              className="empty__example"
              data-index={String(i + 1).padStart(2, '0')}
              onClick={() => onPick(example)}
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function MessageList({ messages, onRetry, canRetry, onPickExample, model }) {
  /* 복원된 대화는 애니메이션 없이 그냥 있어야 한다.
   * 새로고침할 때마다 과거 대화가 줄지어 떠오르면 페이지 로드 연출이지
   * 사용자 행동에 대한 응답이 아니다. 첫 렌더에 있던 id를 기억해 제외한다.
   *
   * ref가 아니라 state로 둔다 — 렌더 중 ref 접근은 React 규칙 위반이고
   * lint가 막는다(react-hooks/refs). 초기화 함수는 첫 렌더에만 실행된다. */
  const [restoredIds] = useState(() => new Set(messages.map((m) => m.id)))

  if (messages.length === 0) {
    return <EmptyState onPick={onPickExample} model={model} />
  }

  const lastIndex = messages.length - 1

  return (
    <div className="messages">
      <ol className="messages__list">
        {messages.map((message, i) => (
          <li
            key={message.id}
            className={`messages__item ${
              restoredIds.has(message.id) ? '' : 'messages__item--enter'
            }`}
          >
            <MessageBubble
              message={message}
              onRetry={onRetry}
              // 재시도는 마지막 교환에만. 중간을 다시 부르면 순서가 엉킨다
              canRetry={canRetry && i === lastIndex}
            />
          </li>
        ))}
      </ol>

      {/* 스크린리더에게 답변 도착을 알린다.
          목록 자체에 aria-live를 걸면 글자가 늘어날 때마다 읽어대므로 분리한다 */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {liveMessage(messages.at(-1))}
      </p>
    </div>
  )
}

function liveMessage(last) {
  if (!last || last.role !== 'assistant') return ''
  if (last.status === 'pending') return '응답을 생성하고 있습니다'
  if (last.status === 'error') return `오류: ${last.content}`
  return `답변이 도착했습니다. ${last.content}`
}
