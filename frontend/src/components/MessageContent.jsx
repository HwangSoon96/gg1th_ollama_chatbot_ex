import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { writeClipboard } from '../lib/clipboard'
import { hasUnclosedFence, normalizeTables } from '../lib/markdown'
import './MessageContent.css'

/* 답변 본문 렌더링 (PRD 4.4-26, 27 / Q4).
 *
 * Q4는 "우선 자체 처리, 전체 마크다운이 필요하다고 판단되면 그때 라이브러리"였다.
 * 실제 응답을 받아보니 그 지점이다 — exaone3.5는 표, **굵게**, 중첩 코드블록을
 * 그대로 뱉는다. 자체 파서로는 코드블록·인라인 코드 둘만 처리하고 있었고
 * 나머지는 파이프 문자와 별표가 화면에 그대로 노출됐다.
 *
 * 표·목록·제목·인용·강조를 직접 파싱하면 1000줄 넘는 버그 덩어리가 된다.
 * 의존성 3개를 넣은 이유:
 *   react-markdown — 파싱·렌더링. 기본값이 raw HTML 미허용이라 XSS 표면이 없다.
 *   remark-gfm     — 표, 취소선, 자동 링크. 모델이 실제로 쓰는 문법이다.
 *   remark-breaks  — 단일 개행을 <br>로. 마크다운 원칙상 단일 개행은 무시되지만
 *                    채팅 답변에서 줄을 바꾼 건 의미가 있다.
 */

function CodeBlock({ lang, children }) {
  const [copied, setCopied] = useState(false)
  const text = String(children ?? '')

  const copy = async () => {
    const ok = await writeClipboard(text)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="code">
      <div className="code__bar">
        <span className="code__lang">{lang || 'text'}</span>
        <button
          type="button"
          className={`code__copy ${copied ? 'code__copy--done' : ''}`}
          onClick={copy}
        >
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
      <pre className="code__body">
        <code>{text.replace(/\n$/, '')}</code>
      </pre>
    </div>
  )
}

/* react-markdown은 펜스 코드를 <pre><code class="language-x">로 준다.
 * pre를 가로채 우리 CodeBlock으로 바꾼다 — 그래야 복사 버튼과 언어 라벨이 붙는다. */
const components = {
  pre({ children }) {
    const code = Array.isArray(children) ? children[0] : children
    const className = code?.props?.className ?? ''
    const lang = className.match(/language-(\w+)/)?.[1] ?? ''
    return <CodeBlock lang={lang}>{code?.props?.children}</CodeBlock>
  },

  code({ className, children, ...rest }) {
    // 펜스 코드는 위 pre가 처리한다. 여기 오는 건 인라인 코드뿐이다.
    return (
      <code className={`msg-inline-code ${className ?? ''}`} {...rest}>
        {children}
      </code>
    )
  },

  // 표는 가로로 넘칠 수 있다. 감싸서 표만 스크롤되게 한다
  table({ children }) {
    return (
      <div className="md-table-wrap">
        <table className="md-table">{children}</table>
      </div>
    )
  },

  /* 로컬 모델이 만들어낸 링크다. 실제로 존재하는 주소라는 보장이 없고,
   * 새 탭으로 여는 편이 대화를 잃지 않는다. noreferrer는 opener 누수 방지. */
  a({ children, ...rest }) {
    return (
      <a {...rest} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
}

export default function MessageContent({ content }) {
  const text = typeof content === 'string' ? content : ''

  return (
    <div className="msg-content">
      {/* 모델이 표 중간에 코드블록을 끼우면 뒤쪽 행들이 표에서 떨어져
          파이프 문자가 그대로 노출된다. 다시 표로 세워서 넘긴다. */}
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {normalizeTables(text)}
      </Markdown>

      {/* 답변이 잘렸다는 사실을 숨기면 사용자는 코드가 원래 그런 줄 안다.
          remark는 닫히지 않은 펜스를 조용히 닫아버리므로 원문을 따로 본다. */}
      {hasUnclosedFence(text) && (
        <p className="msg-truncated">
          최대 생성 길이에 걸려 답변이 잘렸습니다. num_predict를 늘려보세요.
        </p>
      )}
    </div>
  )
}
