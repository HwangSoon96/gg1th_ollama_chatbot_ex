import { useEffect, useRef, useState } from 'react'
import './ClearButton.css'

/* 대화 초기화 (PRD 4.1-10).
 *
 * 되돌릴 수 없으니 확인을 거친다. window.confirm은 쓰지 않는다 —
 * 브라우저 모달은 페이지와 따로 놀고, 한국어 버튼 라벨도 못 준다.
 *
 * 대신 버튼 자리에서 한 번 더 묻는다. 다른 곳을 누르거나 Esc를 누르면 물러난다.
 */

export default function ClearButton({ onClear, disabled }) {
  const [asking, setAsking] = useState(false)
  const wrapRef = useRef(null)
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!asking) return

    confirmRef.current?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setAsking(false)
    }
    const onPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setAsking(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [asking])

  if (!asking) {
    return (
      <button
        type="button"
        className="clear"
        onClick={() => setAsking(true)}
        disabled={disabled}
      >
        대화 비우기
      </button>
    )
  }

  return (
    <span className="clear__confirm" ref={wrapRef}>
      <span className="clear__ask">모두 지울까요?</span>
      <button
        type="button"
        ref={confirmRef}
        className="clear__yes"
        onClick={() => {
          setAsking(false)
          onClear()
        }}
      >
        지우기
      </button>
      <button type="button" className="clear__no" onClick={() => setAsking(false)}>
        취소
      </button>
    </span>
  )
}
