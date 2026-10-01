import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchModels } from '../api/chatApi'
import { loadSettings, saveSettings } from '../lib/storage'

/* 모델·프롬프트·파라미터 상태.
 *
 * 기본값과 범위는 backend/schema.py와 정확히 같아야 한다(PRD 4.3-19).
 * 어긋나면 백엔드가 422로 거절하는데, 그건 사용자 눈에 "그냥 안 되는" 상태로 보인다.
 */

export const DEFAULTS = {
  model: 'exaone3.5:7.8b',
  systemPrompt: '너는 초보자를 돕는 친절한 AI 강사다.',
  temperature: 0.6,
  topP: 0.7,
  numPredict: 256,
  carryContext: true, // PRD Q1
}

/** 슬라이더 범위 = 백엔드 Field 제약. step은 UI 전용. */
export const RANGES = {
  temperature: { min: 0, max: 2, step: 0.1 },
  topP: { min: 0, max: 1, step: 0.05 },
  numPredict: { min: 1, max: 2048, step: 1 },
}

function clamp(value, { min, max }, fallback) {
  /* Number(null), Number(''), Number([]), Number(false)는 전부 0이다.
   * 그대로 통과시키면 깨진 저장값이 "0을 고른 것"으로 둔갑한다.
   * top_p=0은 백엔드가 받아주는 값이라 422도 안 난다 — 사용자는 이유도 모른 채
   * 완전히 결정론적인 모델을 쓰게 된다.
   *
   * range input은 문자열('1.2')을 주므로 숫자만 받도록 좁히지는 않는다. */
  const numeric =
    typeof value === 'number' ||
    (typeof value === 'string' && value.trim() !== '')
  if (!numeric) return fallback

  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * 저장된 설정을 믿지 않고 한 번 거른다.
 * 수동 편집, 다른 탭, 이전 버전 — localStorage에는 무엇이든 들어 있을 수 있다.
 */
export function sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }

  return {
    model:
      typeof raw.model === 'string' && raw.model.trim()
        ? raw.model.trim()
        : DEFAULTS.model,
    systemPrompt:
      typeof raw.systemPrompt === 'string'
        ? raw.systemPrompt
        : DEFAULTS.systemPrompt,
    temperature: clamp(
      raw.temperature,
      RANGES.temperature,
      DEFAULTS.temperature,
    ),
    topP: clamp(raw.topP, RANGES.topP, DEFAULTS.topP),
    numPredict: Math.round(
      clamp(raw.numPredict, RANGES.numPredict, DEFAULTS.numPredict),
    ),
    carryContext:
      typeof raw.carryContext === 'boolean'
        ? raw.carryContext
        : DEFAULTS.carryContext,
  }
}

/** 백엔드가 받는 형태로 변환. 키 이름은 schema.py 기준(snake_case). */
export function toRequestParams(settings) {
  return {
    model: settings.model,
    system_prompt: settings.systemPrompt,
    temperature: settings.temperature,
    top_p: settings.topP,
    num_predict: settings.numPredict,
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(() =>
    sanitizeSettings(loadSettings()),
  )
  const [models, setModels] = useState([])
  const [modelsState, setModelsState] = useState('loading') // loading | ready | failed

  // 첫 렌더의 복원값은 다시 저장할 필요가 없다
  const restored = useRef(true)

  useEffect(() => {
    if (restored.current) {
      restored.current = false
      return
    }
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    let alive = true

    fetchModels()
      .then((list) => {
        if (!alive) return
        setModels(list)
        setModelsState('ready')
      })
      .catch(() => {
        // 목록을 못 받아도 앱은 돌아야 한다(PRD 4.3-15). 기본 모델로 계속 간다.
        if (!alive) return
        setModels([])
        setModelsState('failed')
      })

    return () => {
      alive = false
    }
  }, [])

  const update = useCallback((patch) => {
    setSettings((prev) => sanitizeSettings({ ...prev, ...patch }))
  }, [])

  const reset = useCallback(() => {
    setSettings({ ...DEFAULTS })
  }, [])

  /* 선택된 모델이 목록에 없을 수 있다: 저장된 뒤 삭제됐거나, 목록 로딩이 실패했거나.
   * 이때 select가 값을 잃고 첫 항목으로 튀면 사용자가 모르는 채 다른 모델을 쓰게 된다.
   * 그래서 목록에 없으면 선택지로 끼워 넣는다. */
  const modelOptions = useMemo(() => {
    if (models.includes(settings.model)) return models
    return [settings.model, ...models]
  }, [models, settings.model])

  const isDefault = useMemo(
    () => Object.keys(DEFAULTS).every((k) => settings[k] === DEFAULTS[k]),
    [settings],
  )

  return {
    settings,
    update,
    reset,
    isDefault,
    models,
    modelOptions,
    modelsState,
  }
}
