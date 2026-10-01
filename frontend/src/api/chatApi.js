/* 백엔드(FastAPI) 호출 계층.
 *
 * 계약 (backend/schema.py 기준, 수정 불가):
 *   POST /chat  { message, model, system_prompt, temperature, top_p, num_predict }
 *            -> { model, message, elapsed_time }
 *   GET  /models -> { models: string[] }
 *
 * 이 파일의 책임은 "실패를 말이 되는 형태로 바꾸는 것"이다.
 * fetch는 네트워크 단절도, 500 응답도, 취소도 전부 다르게 던진다.
 * UI가 그걸 일일이 판별하게 두면 오류 메시지가 뭉개진다.
 */

// 개발 중에는 vite 프록시(/api)를 탄다. 배포 시 VITE_API_BASE로 덮어쓴다.
const BASE = import.meta.env?.VITE_API_BASE ?? '/api'

// 로컬 7B 모델은 첫 응답까지 수십 초가 걸린다. 짧게 잡으면 정상 요청을 죽인다.
const TIMEOUT_MS = 120_000

/** 실패 종류. UI는 이 kind로 분기한다. */
export class ChatError extends Error {
  constructor(kind, message, { detail, cause } = {}) {
    super(message)
    this.name = 'ChatError'
    this.kind = kind // offline | timeout | canceled | server | malformed
    this.detail = detail
    this.cause = cause
  }
}

const MESSAGES = {
  offline:
    '백엔드에 연결할 수 없습니다. backend/ 디렉터리에서 `uv run main.py`로 서버를 실행하세요.',
  timeout: `응답이 ${TIMEOUT_MS / 1000}초를 넘겨 중단했습니다. 더 작은 모델을 쓰거나 최대 생성 길이를 줄여보세요.`,
  canceled: '요청을 취소했습니다.',
  malformed: '백엔드가 예상과 다른 형식으로 응답했습니다.',
}

/** 임베딩 전용 모델은 채팅에 쓸 수 없다. /models는 용도를 알려주지 않으므로 이름으로 거른다. */
const EMBEDDING_PATTERN = /(^|[/-])(bge|nomic-embed|all-minilm|mxbai-embed|snowflake-arctic-embed|paraphrase)/i

export function isChatModel(name) {
  return !EMBEDDING_PATTERN.test(name)
}

async function request(path, init = {}, userSignal) {
  // 타임아웃과 사용자 취소는 둘 다 abort지만 사용자에게는 다른 사건이다.
  // 각각 별도 시그널로 두고 합쳐서, 나중에 reason으로 구분한다.
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const signal = userSignal
    ? AbortSignal.any([timeout, userSignal])
    : timeout

  let response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, signal })
  } catch (err) {
    // 사용자 취소가 타임아웃보다 우선 (사용자는 자기가 누른 걸 안다)
    if (userSignal?.aborted) {
      throw new ChatError('canceled', MESSAGES.canceled, { cause: err })
    }
    if (timeout.aborted) {
      throw new ChatError('timeout', MESSAGES.timeout, { cause: err })
    }
    // fetch가 TypeError를 던지는 경우 = 서버에 닿지 못함
    throw new ChatError('offline', MESSAGES.offline, { cause: err })
  }

  /* 게이트웨이 오류 = 프록시는 살아있고 백엔드가 죽은 상태다.
   * 개발 중에는 vite 프록시(/api)가, 배포 후에는 nginx 등이 502를 돌려준다.
   * 이걸 server로 분류하면 "백엔드가 502 오류를 반환했습니다"만 뜨는데,
   * 그건 원인도 다음 행동도 없는 문구다(PRD 4.5-30).
   * 사용자가 해야 할 일은 fetch가 터졌을 때와 똑같다 — 백엔드를 켜라. */
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new ChatError('offline', MESSAGES.offline, { cause: response.status })
  }

  if (!response.ok) {
    // FastAPI의 HTTPException은 { detail: "..." } 로 온다
    const detail = await response
      .json()
      .then((body) => body?.detail)
      .catch(() => null)

    throw new ChatError(
      'server',
      detail
        ? `백엔드에서 오류가 발생했습니다: ${detail}`
        : `백엔드가 ${response.status} 오류를 반환했습니다.`,
      { detail, cause: response.status },
    )
  }

  try {
    return await response.json()
  } catch (err) {
    throw new ChatError('malformed', MESSAGES.malformed, { cause: err })
  }
}

/**
 * 질문을 보내고 모델 응답을 받는다.
 * @param {object} payload ChatRequest 형태
 * @param {AbortSignal} [signal] 사용자 취소용
 */
export async function sendChatMessage(payload, signal) {
  const data = await request(
    '/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    signal,
  )

  if (typeof data?.message !== 'string') {
    throw new ChatError('malformed', MESSAGES.malformed, { detail: data })
  }

  return {
    model: data.model,
    message: data.message,
    elapsedTime: data.elapsed_time,
  }
}

/** 설치된 채팅 가능 모델 목록. 실패해도 앱은 돌아야 하므로 빈 배열을 준다. */
export async function fetchModels() {
  const data = await request('/models')
  const models = Array.isArray(data?.models) ? data.models : []
  return models.filter(isChatModel)
}
