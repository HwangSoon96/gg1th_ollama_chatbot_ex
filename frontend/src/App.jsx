import { useEffect, useRef, useState } from 'react'
import ChatInput from './components/ChatInput'
import ChatWindow from './components/ChatWindow'
import ClearButton from './components/ClearButton'
import SettingsPanel from './components/SettingsPanel'
import ThemeToggle from './components/ThemeToggle'
import { useChat } from './hooks/useChat'
import { useSettings } from './hooks/useSettings'
import { useTheme } from './hooks/useTheme'
import { loadRailOpen, saveRailOpen } from './lib/storage'
import './App.css'

function App() {
  const { settings, update, reset, isDefault, modelOptions, modelsState } =
    useSettings()
  const { messages, isSending, send, cancel, retry, canRetry, clear } = useChat(settings)
  const { theme, isSystem, toggle } = useTheme()

  const inputRef = useRef(null)

  /* 데스크톱은 레일로 펼쳐 두고 접을 수 있게, 모바일은 시트로 띄운다(Q6).
   * 같은 패널을 두 방식으로 보여주므로 컴포넌트는 하나다. */
  const [railOpen, setRailOpen] = useState(() => loadRailOpen())
  const [sheetOpen, setSheetOpen] = useState(false)

  // 첫 렌더의 복원값은 다시 저장할 필요가 없다 (useSettings·useTheme과 같은 규약)
  const restored = useRef(true)
  useEffect(() => {
    if (restored.current) {
      restored.current = false
      return
    }
    saveRailOpen(railOpen)
  }, [railOpen])

  useEffect(() => {
    if (!sheetOpen) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSheetOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sheetOpen])

  /* 에디터 관습대로 Ctrl/Cmd+B로 접는다. 입력 중에도 동작해야 하므로
   * textarea에서 막지 않는다 — B는 입력에 쓰이지만 수식키가 붙으면 글자가 아니다. */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'b' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setRailOpen((open) => !open)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const panel = (
    <SettingsPanel
      settings={settings}
      update={update}
      reset={reset}
      isDefault={isDefault}
      modelOptions={modelOptions}
      modelsState={modelsState}
    />
  )

  return (
    <div className={`app ${railOpen ? '' : 'app--rail-closed'}`}>
      <main className="app__main">
        <header className="masthead">
          <h1 className="masthead__title">
            로컬 <span className="masthead__mark">LLM</span>
            <span className="masthead__dot">.</span>
          </h1>

          {/* 지금 걸린 모델과 기계가 일하는지. 계기판의 주 눈금 */}
          <div
            className={`masthead__readout ${isSending ? 'masthead__readout--live' : ''}`}
          >
            <span className="masthead__pulse" aria-hidden="true" />
            {/* key를 바꿔 모델이 바뀔 때 새로 마운트되게 한다.
                설정을 만졌는데 화면이 조용하면 바뀜 건지 확신이 안 선다. */}
            <span className="masthead__model" key={settings.model}>
              {settings.model}
            </span>
          </div>

          <div className="masthead__actions">
            <ClearButton onClear={clear} disabled={messages.length === 0} />
            <ThemeToggle theme={theme} isSystem={isSystem} onToggle={toggle} />

            {/* 데스크톱: 레일 접기 */}
            <button
              type="button"
              className="masthead__rail-toggle"
              onClick={() => setRailOpen((open) => !open)}
              aria-expanded={railOpen}
              aria-controls="settings-rail"
              title="설정 패널 (Ctrl+B)"
            >
              <span className="masthead__chevron" aria-hidden="true">
                ›
              </span>
              설정
            </button>

            {/* 모바일: 시트 */}
            <button
              type="button"
              className="masthead__settings"
              onClick={() => setSheetOpen(true)}
              aria-expanded={sheetOpen}
            >
              설정
            </button>
          </div>
        </header>

        <ChatWindow
          messages={messages}
          onRetry={retry}
          canRetry={canRetry}
          onPickExample={(text) => inputRef.current?.fill(text)}
          model={settings.model}
        />

        <ChatInput
          ref={inputRef}
          onSend={send}
          onStop={cancel}
          isSending={isSending}
        />
      </main>

      {/* 접혀 있을 때는 키보드 순회에서도 빠져야 한다.
          보이지 않는 컨트롤에 포커스가 들어가면 사용자는 어디 있는지 알 수 없다. */}
      <aside className="app__rail" id="settings-rail" inert={!railOpen}>
        <div className="app__rail-inner">{panel}</div>
      </aside>

      {sheetOpen && (
        <div className="sheet">
          <button
            type="button"
            className="sheet__scrim"
            aria-label="설정 닫기"
            onClick={() => setSheetOpen(false)}
          />
          <div className="sheet__panel" role="dialog" aria-label="설정">
            <div className="sheet__grip" aria-hidden="true" />
            {panel}
            <button
              type="button"
              className="sheet__close"
              onClick={() => setSheetOpen(false)}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
