// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { THEME_KEY } from '../lib/storage'
import { applyTheme, resolveTheme, useTheme } from './useTheme'

/**
 * jsdom에는 matchMedia가 없다. OS 다크 설정을 흉내 내고,
 * 앱이 떠 있는 동안 OS가 바뀌는 상황까지 재현할 수 있게 리스너를 들고 있는다.
 */
function mockMatchMedia(dark) {
  const listeners = new Set()

  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  }

  globalThis.matchMedia = () => mql

  return {
    get listenerCount() {
      return listeners.size
    },
    /** OS 설정이 바뀐 순간 */
    change(next) {
      mql.matches = next
      for (const fn of listeners) fn({ matches: next })
    },
  }
}

const root = () => document.documentElement
const attr = () => root().getAttribute('data-theme')

beforeEach(() => {
  localStorage.clear()
  root().removeAttribute('data-theme')
  mockMatchMedia(false)
})

afterEach(() => {
  delete globalThis.matchMedia
})

describe('resolveTheme', () => {
  it('수동 선택은 OS와 무관하게 그대로 쓴다', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it("'system'은 OS를 따라간다", () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('applyTheme', () => {
  it('수동 선택은 data-theme으로 박는다', () => {
    applyTheme('dark')
    expect(attr()).toBe('dark')

    applyTheme('light')
    expect(attr()).toBe('light')
  })

  it("'system'은 속성을 지운다 (박아두면 OS를 못 따라간다)", () => {
    // tokens.css의 @media (prefers-color-scheme: dark)는
    // :root:not([data-theme='light'])로 걸려 있다. 값이 남으면 그 경로가 죽는다.
    applyTheme('dark')
    applyTheme('system')

    expect(attr()).toBeNull()
  })
})

describe('useTheme', () => {
  it("기본은 OS 추종이고 속성을 남기지 않는다", () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.preference).toBe('system')
    expect(result.current.isSystem).toBe(true)
    expect(attr()).toBeNull()
  })

  it('OS가 다크면 system 상태에서 다크로 읽힌다', () => {
    mockMatchMedia(true)

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
    expect(attr()).toBeNull() // 그래도 속성은 안 박는다
  })

  it('수동 선택은 저장되고 <html>에 반영된다', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('dark'))

    expect(result.current.theme).toBe('dark')
    expect(attr()).toBe('dark')
    expect(JSON.parse(localStorage.getItem(THEME_KEY))).toBe('dark')
  })

  it('저장된 선택을 새로고침 후 복원한다', () => {
    localStorage.setItem(THEME_KEY, JSON.stringify('dark'))

    const { result } = renderHook(() => useTheme())

    expect(result.current.preference).toBe('dark')
    expect(attr()).toBe('dark')
  })

  it('OS가 다크여도 수동 라이트 선택이 이긴다', () => {
    mockMatchMedia(true)
    localStorage.setItem(THEME_KEY, JSON.stringify('light'))

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')
    expect(attr()).toBe('light')
  })

  it('system일 때 OS가 바뀌면 따라간다', () => {
    // 새로고침 전까지 낮 색이 남으면 안 된다 (야간 모드 자동 전환)
    const os = mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')

    act(() => os.change(true))

    expect(result.current.theme).toBe('dark')
  })

  it('수동 선택 중에는 OS가 바뀌어도 흔들리지 않는다', () => {
    const os = mockMatchMedia(false)
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('light'))
    act(() => os.change(true))

    expect(result.current.theme).toBe('light')
    expect(attr()).toBe('light')
  })

  it('언마운트하면 OS 리스너를 떼어낸다', () => {
    const os = mockMatchMedia(false)
    const { unmount } = renderHook(() => useTheme())

    expect(os.listenerCount).toBe(1)

    unmount()

    expect(os.listenerCount).toBe(0)
  })

  describe('원형 확산 전환', () => {
    it('View Transition을 쓰고 색을 바꿈다', () => {
      const calls = []
      document.startViewTransition = (cb) => {
        calls.push(cb)
        cb()
        return { finished: Promise.resolve() }
      }

      const { result } = renderHook(() => useTheme())
      act(() => result.current.toggle())

      expect(calls).toHaveLength(1)
      expect(result.current.theme).toBe('dark')
      delete document.startViewTransition
    })

    it('누른 지점을 원의 중심으로 잡는다', () => {
      document.startViewTransition = (cb) => {
        cb()
        return { finished: Promise.resolve() }
      }

      const { result } = renderHook(() => useTheme())
      act(() =>
        result.current.toggle({
          currentTarget: {
            getBoundingClientRect: () => ({ left: 100, top: 40, width: 20, height: 10 }),
          },
        }),
      )

      // 버튼 중심 = (110, 45)
      expect(root().style.getPropertyValue('--reveal-x')).toBe('110px')
      expect(root().style.getPropertyValue('--reveal-y')).toBe('45px')
      // 반지름은 가장 먼 모서리까지 덮어야 이전 색이 남지 않는다
      expect(parseFloat(root().style.getPropertyValue('--reveal-r'))).toBeGreaterThan(0)
      delete document.startViewTransition
    })

    it('미지원 브라우저에서도 색은 바뀜다', () => {
      // 애니메이션이 없을 뿐 기능이 죽으면 안 된다
      expect(document.startViewTransition).toBeUndefined()

      const { result } = renderHook(() => useTheme())
      act(() => result.current.toggle())

      expect(result.current.theme).toBe('dark')
      expect(attr()).toBe('dark')
    })

    it('모션을 끈 사용자에겐 전환 연출을 쓰지 않는다', () => {
      // 화면 전체가 움직이는 연출은 멀미를 일으키는 대표적인 경우다
      let called = false
      document.startViewTransition = (cb) => {
        called = true
        cb()
        return { finished: Promise.resolve() }
      }
      globalThis.matchMedia = (q) => ({
        matches: q.includes('reduced-motion'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      })

      const { result } = renderHook(() => useTheme())
      act(() => result.current.toggle())

      expect(called).toBe(false)
      expect(result.current.theme).toBe('dark') // 색은 그래도 바뀐다
      delete document.startViewTransition
    })
  })

  describe('토글', () => {
    it('라이트에서 누르면 다크', () => {
      const { result } = renderHook(() => useTheme())

      act(() => result.current.toggle())

      expect(result.current.theme).toBe('dark')
    })

    it('다크에서 누르면 라이트', () => {
      localStorage.setItem(THEME_KEY, JSON.stringify('dark'))
      const { result } = renderHook(() => useTheme())

      act(() => result.current.toggle())

      expect(result.current.theme).toBe('light')
    })

    it('OS가 다크인 system 상태에서 누르면 라이트로 간다', () => {
      /* 여기서 'light'가 아니라 'dark'를 고르면 화면이 그대로다.
       * 토글을 눌렀는데 아무 일도 안 일어나는 것처럼 보인다. */
      mockMatchMedia(true)
      const { result } = renderHook(() => useTheme())

      act(() => result.current.toggle())

      expect(result.current.preference).toBe('light')
      expect(result.current.theme).toBe('light')
    })

    it('OS가 라이트인 system 상태에서 누르면 다크로 간다', () => {
      const { result } = renderHook(() => useTheme())

      act(() => result.current.toggle())

      expect(result.current.preference).toBe('dark')
      expect(result.current.theme).toBe('dark')
    })
  })
})
