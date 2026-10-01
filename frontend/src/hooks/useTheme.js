import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { loadTheme, saveTheme } from '../lib/storage'

/* 다크 모드 (PRD 4.7-39: OS 설정 추종 + 수동 전환).
 *
 * 선택지는 셋이다: system | light | dark.
 * 'system'은 "지금 다크"라는 뜻이 아니라 "OS를 따라간다"는 뜻이다. 그래서 값을 고정하지 않고
 * 속성을 지운다 — tokens.css의 @media (prefers-color-scheme: dark)가 그때 살아난다.
 * 수동 선택은 [data-theme]로 박아 OS가 바뀌어도 흔들리지 않게 한다.
 *
 * 색 정의는 전부 tokens.css에 있다. 이 훅은 "어느 경로를 쓸지"만 정한다.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** matchMedia가 없는 환경(구형 jsdom, SSR)에서도 앱은 떠야 한다. */
function prefersDark() {
  try {
    return globalThis.matchMedia?.(DARK_QUERY).matches ?? false
  } catch {
    return false
  }
}

/** 화면에 실제로 칠해지는 값. 'system'이면 OS에 물어본다. */
export function resolveTheme(preference, systemDark) {
  if (preference === 'light' || preference === 'dark') return preference
  return systemDark ? 'dark' : 'light'
}

/**
 * <html>에 선택을 반영한다.
 * 'system'은 속성을 지운다. 값을 박아두면 OS를 따라가지 못한다.
 */
export function applyTheme(preference, root = globalThis.document?.documentElement) {
  if (!root) return
  if (preference === 'light' || preference === 'dark') {
    root.setAttribute('data-theme', preference)
  } else {
    root.removeAttribute('data-theme')
  }
}

export function useTheme() {
  const [preference, setPreference] = useState(() => loadTheme())
  const [systemDark, setSystemDark] = useState(prefersDark)

  // 첫 렌더의 복원값은 다시 저장할 필요가 없다 (useSettings와 같은 규약)
  const restored = useRef(true)

  // 페인트 전에 맞춘다. useEffect로 두면 라이트로 한 프레임 깜빡인다.
  useEffect(() => {
    applyTheme(preference)

    if (restored.current) {
      restored.current = false
      return
    }
    saveTheme(preference)
  }, [preference])

  /* OS 설정은 앱이 떠 있는 동안에도 바뀐다(야간 모드 자동 전환).
   * 'system'일 때 이걸 듣지 않으면 새로고침 전까지 낮 색이 남는다. */
  useEffect(() => {
    const mql = globalThis.matchMedia?.(DARK_QUERY)
    if (!mql) return

    const onChange = (event) => setSystemDark(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(preference, systemDark)

  /* 토글은 지금 보이는 색의 반대로 간다.
   * 'system'에서 눌렀을 때 'light'로 가면 OS가 다크인 사용자는 아무 변화도 못 본다.
   *
   * 색이 한 번에 바뀜면 화면이 눈에 튀다. 누른 지점에서 원이 퍼지게 해
   * "내가 여기를 눌러서 저게 바뀜였다"를 보여준다(View Transitions API).
   * 미지원 브라우저나 모션을 끔 사용자는 그냥 즉시 전환된다. */
  const toggle = useCallback(
    (event) => {
      const next = resolveTheme(preference, systemDark) === 'dark' ? 'light' : 'dark'

      const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      if (reduced || typeof document === 'undefined' || !document.startViewTransition) {
        setPreference(next)
        return
      }

      // 원의 중심은 누른 버튼이다. 없으면(키보드 등) 화면 가운데.
      const rect = event?.currentTarget?.getBoundingClientRect?.()
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
      // 가장 먼 모서리까지 덮어야 화면에 이전 색이 남지 않는다
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      )

      const root = document.documentElement
      root.style.setProperty('--reveal-x', `${x}px`)
      root.style.setProperty('--reveal-y', `${y}px`)
      root.style.setProperty('--reveal-r', `${radius}px`)

      // flushSync가 없으면 React가 상태 변경을 나중으로 미뤄
      // 전환이 끝난 뒤에 색이 바뀜다
      document.startViewTransition(() => {
        flushSync(() => setPreference(next))
      })
    },
    [preference, systemDark],
  )

  return {
    preference, // system | light | dark
    theme: resolved, // 지금 화면에 칠해진 값
    isSystem: preference === 'system',
    setTheme: setPreference,
    toggle,
  }
}
