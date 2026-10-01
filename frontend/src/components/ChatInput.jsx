import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import './ChatInput.css'

/* 입력창 (PRD 4.1-1~4, 9 / 설계도 개선: 로딩 중 중단 수단).
 *
 * 전송 버튼은 대기 중에 "중단"이 된다. 비활성화만 하면 사용자가 갇힌다 —
 * 로컬 모델이 2분을 먹는 동안 할 수 있는 일이 없어진다.
 */

const MAX_ROWS = 10

export default function ChatInput({ onSend, onStop, isSending, ref }) {
  const [value, setValue] = useState('')
  const textareaRef = useRef(null)

  // 예시 클릭(4.3)이 입력창을 채우고 포커스까지 가져간다
  useImperativeHandle(ref, () => ({
    fill(text) {
      setValue(text)
      textareaRef.current?.focus()
    },
  }))

  /* 내용에 맞춰 높이를 키운다. 먼저 auto로 되돌리지 않으면 줄을 지워도 줄지 않는다. */
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return

    el.style.height = 'auto'
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS)}px`
  }, [value])

  // 답변이 끝나면 다음 질문을 바로 칠 수 있어야 한다
  useEffect(() => {
    if (!isSending) textareaRef.current?.focus()
  }, [isSending])

  const submit = () => {
    if (isSending) return
    if (onSend(value)) setValue('') // 거절당하면(빈 입력) 지우지 않는다
  }

  const onKeyDown = (event) => {
    // IME 조합 중의 Enter는 한글을 확정하는 키다. 여기서 보내면 글자가 잘린다.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="composer__box">
        <label className="visually-hidden" htmlFor="chat-input">
          질문 입력
        </label>
        <textarea
          id="chat-input"
          ref={textareaRef}
          className="composer__input"
          rows={1}
          value={value}
          placeholder="무엇이든 물어보세요"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />

        {/* key를 나눠 서로 교체될 때 등장 애니메이션이 터지게 한다.
            같은 자리에서 역할이 바뀌는 것이라 흐름이 보여야 한다 */}
        {isSending ? (
          <button
            key="stop"
            type="button"
            className="composer__stop composer__swap"
            onClick={onStop}
          >
            중단
          </button>
        ) : (
          <button
            key="send"
            type="submit"
            className="composer__send composer__swap"
            disabled={!value.trim()}
          >
            전송
          </button>
        )}
      </div>

      <p className="composer__hint">
        <span className="composer__key">Enter</span> 전송 ·{' '}
        <span className="composer__key">Shift+Enter</span> 줄바꿈
      </p>
    </form>
  )
}
