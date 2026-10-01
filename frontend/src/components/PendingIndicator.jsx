import { useEffect, useState } from 'react'
import './PendingIndicator.css'

/* 응답 대기 표현 (PRD 4.1-7, 비목표: 스트리밍 불가).
 *
 * 백엔드는 생성이 끝나야 답을 준다. 로컬 7B는 수십 초가 걸린다.
 * 그 사이 화면이 비어 있으면 사용자는 멈춘 줄 안다.
 *
 * 그래서 "도는 원" 대신 초를 센다. 숫자가 올라가는 건 살아 있다는 증거다.
 * 스피너는 얼어붙어도 똑같이 돈다.
 */

function useElapsed(startedAt) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return
    // 100ms마다 다시 그릴 이유가 없다. 초 단위로만 바뀐다.
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [startedAt])

  if (!startedAt) return 0
  return Math.max(0, (now - startedAt) / 1000)
}

/** 기다림이 길어질수록 다른 말을 한다. 같은 문구가 40초간 떠 있으면 멈춘 것처럼 보인다. */
function hint(seconds) {
  if (seconds < 10) return null
  if (seconds < 30) return '로컬 모델은 첫 응답까지 시간이 걸립니다.'
  if (seconds < 90) return '긴 답변을 쓰는 중입니다. 중단하려면 아래 중단을 누르세요.'
  return '120초가 지나면 자동으로 중단됩니다.'
}

export default function PendingIndicator({ model, startedAt }) {
  const elapsed = useElapsed(startedAt)
  const message = hint(elapsed)

  return (
    <div className="pending">
      <div className="pending__head">
        <span className="pending__pulse" aria-hidden="true" />
        <span className="pending__label">{model || '모델'}</span>
        <span className="pending__time tnum">{elapsed.toFixed(1)}s</span>
      </div>
      {message && <p className="pending__hint">{message}</p>}
    </div>
  )
}
