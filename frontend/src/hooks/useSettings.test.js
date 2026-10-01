// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_KEY } from '../lib/storage'
import {
  DEFAULTS,
  RANGES,
  sanitizeSettings,
  toRequestParams,
  useSettings,
} from './useSettings'

vi.mock('../api/chatApi', () => ({
  fetchModels: vi.fn(),
}))

const { fetchModels } = await import('../api/chatApi')

beforeEach(() => {
  localStorage.clear()
  vi.mocked(fetchModels).mockReset()
  vi.mocked(fetchModels).mockResolvedValue([])
})

describe('백엔드 계약', () => {
  /* backend/schema.py는 수정 불가다. 여기가 어긋나면 백엔드가 422로 거절하고,
   * 사용자 눈에는 "그냥 안 되는" 상태로 보인다. */
  it('기본값이 schema.py의 default와 같다', () => {
    expect(DEFAULTS.model).toBe('exaone3.5:7.8b')
    expect(DEFAULTS.systemPrompt).toBe('너는 초보자를 돕는 친절한 AI 강사다.')
    expect(DEFAULTS.temperature).toBe(0.6)
    expect(DEFAULTS.topP).toBe(0.7)
    expect(DEFAULTS.numPredict).toBe(256)
  })

  it('범위가 schema.py의 ge/le와 같다', () => {
    expect(RANGES.temperature).toMatchObject({ min: 0, max: 2 })
    expect(RANGES.topP).toMatchObject({ min: 0, max: 1 })
    expect(RANGES.numPredict).toMatchObject({ min: 1, max: 2048 })
  })

  it('요청 키를 snake_case로 바꾼다', () => {
    expect(toRequestParams(DEFAULTS)).toEqual({
      model: 'exaone3.5:7.8b',
      system_prompt: '너는 초보자를 돕는 친절한 AI 강사다.',
      temperature: 0.6,
      top_p: 0.7,
      num_predict: 256,
    })
  })

  it('요청 본문에 carryContext를 섞어 보내지 않는다', () => {
    // 백엔드가 모르는 키다. 프론트 전용 상태가 새어 나가면 안 된다.
    expect(toRequestParams(DEFAULTS)).not.toHaveProperty('carryContext')
  })
})

describe('sanitizeSettings', () => {
  it('저장된 값이 없으면 기본값', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULTS)
    expect(sanitizeSettings('엉뚱한 값')).toEqual(DEFAULTS)
  })

  it('범위를 벗어난 값은 경계로 자른다', () => {
    const s = sanitizeSettings({ temperature: 99, topP: -3, numPredict: 99999 })

    expect(s.temperature).toBe(2)
    expect(s.topP).toBe(0)
    expect(s.numPredict).toBe(2048)
  })

  it('숫자가 아닌 값은 기본값으로 되돌린다', () => {
    const s = sanitizeSettings({ temperature: '뜨겁게', topP: null, numPredict: NaN })

    expect(s.temperature).toBe(DEFAULTS.temperature)
    expect(s.topP).toBe(DEFAULTS.topP)
    expect(s.numPredict).toBe(DEFAULTS.numPredict)
  })

  it('0으로 해석되는 빈 값은 기본값으로 되돌린다', () => {
    /* Number(null) === 0, Number('') === 0, Number([]) === 0.
     * 그대로 두면 깨진 저장값이 top_p=0으로 둔갑하고,
     * 백엔드는 0을 정상 범위로 받아들인다. 오류가 안 나니 더 나쁘다.
     * (3.5 테스트에서 발견한 실제 버그 — 3.8) */
    expect(sanitizeSettings({ topP: null }).topP).toBe(DEFAULTS.topP)
    expect(sanitizeSettings({ topP: '' }).topP).toBe(DEFAULTS.topP)
    expect(sanitizeSettings({ topP: '   ' }).topP).toBe(DEFAULTS.topP)
    expect(sanitizeSettings({ topP: [] }).topP).toBe(DEFAULTS.topP)
    expect(sanitizeSettings({ topP: false }).topP).toBe(DEFAULTS.topP)
    expect(sanitizeSettings({ numPredict: null }).numPredict).toBe(DEFAULTS.numPredict)
  })

  it('사용자가 직접 고른 0은 그대로 둔다', () => {
    // 깨진 값과 의도한 0을 구분해야 한다
    expect(sanitizeSettings({ topP: 0 }).topP).toBe(0)
    expect(sanitizeSettings({ temperature: 0 }).temperature).toBe(0)
  })

  it('range input이 주는 숫자 문자열은 받아들인다', () => {
    // <input type="range">의 value는 항상 문자열이다
    expect(sanitizeSettings({ temperature: '1.2' }).temperature).toBe(1.2)
    expect(sanitizeSettings({ numPredict: '512' }).numPredict).toBe(512)
  })

  it('num_predict는 정수여야 한다 (백엔드가 int로 받는다)', () => {
    expect(sanitizeSettings({ numPredict: 100.7 }).numPredict).toBe(101)
  })

  it('빈 모델명은 기본 모델로 되돌린다', () => {
    // 빈 문자열을 그대로 보내면 Ollama가 모델을 못 찾는다
    expect(sanitizeSettings({ model: '   ' }).model).toBe(DEFAULTS.model)
    expect(sanitizeSettings({ model: 42 }).model).toBe(DEFAULTS.model)
  })

  it('모델명의 공백은 떼어낸다', () => {
    expect(sanitizeSettings({ model: '  qwen3.5:9b ' }).model).toBe('qwen3.5:9b')
  })

  it('빈 시스템 프롬프트는 사용자의 선택이므로 지운 대로 둔다', () => {
    expect(sanitizeSettings({ systemPrompt: '' }).systemPrompt).toBe('')
  })

  it('carryContext가 boolean이 아니면 기본값(ON)', () => {
    expect(sanitizeSettings({ carryContext: 'true' }).carryContext).toBe(true)
    expect(sanitizeSettings({ carryContext: false }).carryContext).toBe(false)
  })
})

describe('useSettings', () => {
  it('저장된 설정을 복원한다', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULTS, model: 'qwen3.5:9b', temperature: 1.2 }),
    )

    const { result } = renderHook(() => useSettings())

    expect(result.current.settings.model).toBe('qwen3.5:9b')
    expect(result.current.settings.temperature).toBe(1.2)
  })

  it('저장된 값이 깨져 있어도 기본값으로 뜬다', () => {
    localStorage.setItem(SETTINGS_KEY, '{"깨진')

    const { result } = renderHook(() => useSettings())

    expect(result.current.settings).toEqual(DEFAULTS)
  })

  it('복원만 하고 아무것도 안 바꿨으면 다시 저장하지 않는다', () => {
    const { result } = renderHook(() => useSettings())

    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull()
    expect(result.current.isDefault).toBe(true)
  })

  it('바꾸면 저장한다', async () => {
    const { result } = renderHook(() => useSettings())

    act(() => result.current.update({ temperature: 1.5 }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)).temperature).toBe(1.5)
    })
  })

  it('범위를 벗어난 입력은 저장 전에 잘린다', () => {
    const { result } = renderHook(() => useSettings())

    act(() => result.current.update({ temperature: 100 }))

    expect(result.current.settings.temperature).toBe(2)
  })

  it('기본값 복원은 모든 값을 되돌린다', () => {
    const { result } = renderHook(() => useSettings())

    act(() => result.current.update({ temperature: 1.9, model: 'qwen3.5:9b' }))
    expect(result.current.isDefault).toBe(false)

    act(() => result.current.reset())

    expect(result.current.settings).toEqual(DEFAULTS)
    expect(result.current.isDefault).toBe(true)
  })

  it('모델 목록을 불러온다', async () => {
    vi.mocked(fetchModels).mockResolvedValue(['exaone3.5:7.8b', 'qwen3.5:9b'])

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current.modelsState).toBe('ready'))
    expect(result.current.models).toEqual(['exaone3.5:7.8b', 'qwen3.5:9b'])
  })

  it('목록 로딩이 실패해도 앱은 기본 모델로 동작한다', async () => {
    // PRD 4.3-15: 목록을 못 받아도 앱은 돌아야 한다
    vi.mocked(fetchModels).mockRejectedValue(new Error('offline'))

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current.modelsState).toBe('failed'))
    expect(result.current.settings.model).toBe(DEFAULTS.model)
    expect(result.current.modelOptions).toEqual([DEFAULTS.model])
  })

  it('선택된 모델이 목록에 없으면 선택지에 끼워 넣는다', async () => {
    /* 끼워 넣지 않으면 select가 값을 잃고 첫 항목으로 튄다.
     * 사용자는 모르는 채 다른 모델로 질문하게 된다. */
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULTS, model: '지워진모델:7b' }),
    )
    vi.mocked(fetchModels).mockResolvedValue(['qwen3.5:9b'])

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current.modelsState).toBe('ready'))
    expect(result.current.modelOptions).toEqual(['지워진모델:7b', 'qwen3.5:9b'])
  })

  it('목록에 있는 모델은 중복으로 넣지 않는다', async () => {
    vi.mocked(fetchModels).mockResolvedValue(['exaone3.5:7.8b', 'qwen3.5:9b'])

    const { result } = renderHook(() => useSettings())

    await waitFor(() => expect(result.current.modelsState).toBe('ready'))
    expect(result.current.modelOptions).toEqual(['exaone3.5:7.8b', 'qwen3.5:9b'])
  })
})
