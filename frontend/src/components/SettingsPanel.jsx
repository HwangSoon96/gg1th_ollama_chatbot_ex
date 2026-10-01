import { useLayoutEffect, useRef } from 'react'
import { RANGES } from '../hooks/useSettings'
import Parameter from './Parameter'
import './SettingsPanel.css'

/* 설정 패널 (PRD 4.3-16~22, 4.2-12/13).
 *
 * 채팅이 주인공이고 설정은 보조다. 데스크톱에서는 레일로 항상 두되
 * 시각적 무게를 낮추고, 모바일에서는 시트로 띄운다(Q6).
 */

function SystemPrompt({ value, onChange }) {
  const ref = useRef(null)

  // 내용에 맞춰 높이를 키운다. 프롬프트는 길어질 수 있다.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [value])

  return (
    <div className="settings__field">
      <label className="settings__label" htmlFor="system-prompt">
        시스템 프롬프트
      </label>
      <textarea
        id="system-prompt"
        ref={ref}
        className="settings__textarea"
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="settings__hint">모델의 말투와 역할을 정합니다.</p>
    </div>
  )
}

function ModelField({ value, options, state, onChange }) {
  return (
    <div className="settings__field">
      <label className="settings__label" htmlFor="model-select">
        모델
      </label>

      {/* 목록을 못 받아도 앱은 돌아야 한다(4.3-15).
          이때는 select 대신 직접 입력을 준다 — 설치된 모델명을 아는 사람은 칠 수 있다. */}
      {state === 'failed' ? (
        <>
          <input
            id="model-select"
            className="settings__input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
          />
          <p className="settings__hint settings__hint--warn">
            모델 목록을 불러오지 못했습니다. 이름을 직접 입력하세요.
          </p>
        </>
      ) : (
        <select
          id="model-select"
          className="settings__select"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={state === 'loading'}
        >
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export default function SettingsPanel({
  settings,
  update,
  reset,
  isDefault,
  modelOptions,
  modelsState,
}) {
  return (
    <div className="settings">
      <div className="settings__head">
        <h2 className="settings__title">설정</h2>
        <button
          type="button"
          className="settings__reset"
          onClick={reset}
          disabled={isDefault}
        >
          기본값으로
        </button>
      </div>

      <ModelField
        value={settings.model}
        options={modelOptions}
        state={modelsState}
        onChange={(model) => update({ model })}
      />

      <SystemPrompt
        value={settings.systemPrompt}
        onChange={(systemPrompt) => update({ systemPrompt })}
      />

      <div className="settings__group">
        <Parameter
          label="temperature"
          hint="높을수록 다양하고 낮을수록 일관됩니다."
          value={settings.temperature}
          {...RANGES.temperature}
          onChange={(temperature) => update({ temperature })}
          format={(v) => v.toFixed(1)}
        />
        <Parameter
          label="top_p"
          hint="단어 후보의 범위입니다. 낮을수록 안전한 표현만 씁니다."
          value={settings.topP}
          {...RANGES.topP}
          onChange={(topP) => update({ topP })}
          format={(v) => v.toFixed(2)}
        />
        <Parameter
          label="num_predict"
          hint="최대 생성 길이입니다. 길수록 오래 걸립니다."
          value={settings.numPredict}
          {...RANGES.numPredict}
          onChange={(numPredict) => update({ numPredict })}
        />
      </div>

      <div className="settings__field">
        <label className="settings__toggle">
          <input
            type="checkbox"
            checked={settings.carryContext}
            onChange={(event) => update({ carryContext: event.target.checked })}
          />
          <span>이전 대화 이어가기</span>
        </label>

        {/* 꺼져 있다는 사실이 화면에 보여야 한다(4.2-13).
            백엔드가 stateless라 이게 꺼지면 모델은 직전 질문도 모른다. */}
        <p
          className={`settings__hint ${settings.carryContext ? '' : 'settings__hint--warn'}`}
        >
          {settings.carryContext
            ? '최근 6턴을 함께 보냅니다.'
            : '꺼짐 — 매 질문이 독립적입니다. 모델이 이전 대화를 모릅니다.'}
        </p>
      </div>
    </div>
  )
}
