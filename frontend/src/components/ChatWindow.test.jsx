// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ChatWindow from './ChatWindow'

// vitest globals를 켜지 않은 프로젝트라 자동 cleanup이 붙지 않는다
afterEach(cleanup)

/* jsdom은 레이아웃을 계산하지 않는다 — scrollHeight/clientHeight가 전부 0이다.
 * "위로 올려 읽는 중"을 만들려면 그 값을 직접 심어야 한다. */
function fakeScroll(el, { scrollHeight, clientHeight, scrollTop }) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  el.scrollTop = scrollTop
}

const exchange = [
  { id: 'q1', role: 'user', content: '안녕', status: 'done' },
  { id: 'a1', role: 'assistant', content: '안녕하세요', status: 'done' },
]

const view = (messages) => (
  <ChatWindow
    messages={messages}
    onRetry={() => {}}
    canRetry={false}
    onPickExample={() => {}}
    model="qwen3.5:9b"
  />
)

const jumpButton = () => screen.queryByRole('button', { name: /맨 아래로/ })

describe('ChatWindow 맨 아래로 버튼', () => {
  it('위로 올려 읽는 중이면 버튼이 나온다', () => {
    render(view(exchange))
    const viewport = screen.getByRole('log', { name: '대화 내역' })

    fakeScroll(viewport, { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })
    fireEvent.scroll(viewport)

    expect(jumpButton()).not.toBeNull()
  })

  it('대화를 비우면 scroll 이벤트가 없어도 버튼이 사라진다', () => {
    const { rerender } = render(view(exchange))
    const viewport = screen.getByRole('log', { name: '대화 내역' })

    fakeScroll(viewport, { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })
    fireEvent.scroll(viewport)
    expect(jumpButton()).not.toBeNull()

    /* 비우면 내용이 사라져 스크롤 높이가 뷰포트와 같아진다.
     * 브라우저는 이때 scroll 이벤트를 주지 않을 수 있다 — 그래서 일부러 발생시키지 않는다. */
    fakeScroll(viewport, { scrollHeight: 500, clientHeight: 500, scrollTop: 0 })
    rerender(view([]))

    expect(jumpButton()).toBeNull()
  })

  it('비운 뒤에는 안 본 답변 알림도 남지 않는다', () => {
    const { rerender } = render(view(exchange))
    const viewport = screen.getByRole('log', { name: '대화 내역' })

    // 위로 올려둔 상태에서 새 답변이 도착하면 "새 답변 도착"이 뜬다
    fakeScroll(viewport, { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 })
    fireEvent.scroll(viewport)
    rerender(
      view([
        ...exchange,
        { id: 'q2', role: 'user', content: '또 질문', status: 'done' },
        { id: 'a2', role: 'assistant', content: '또 답변', status: 'done' },
      ]),
    )
    expect(screen.queryByRole('button', { name: /새 답변 도착/ })).not.toBeNull()

    fakeScroll(viewport, { scrollHeight: 500, clientHeight: 500, scrollTop: 0 })
    rerender(view([]))

    expect(screen.queryByRole('button', { name: /새 답변 도착/ })).toBeNull()
    expect(jumpButton()).toBeNull()
  })
})
