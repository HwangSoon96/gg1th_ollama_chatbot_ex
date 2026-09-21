from fastapi import FastAPI, HTTPException
import uvicorn
# ollama_chat 모듈의 call_ollama_chat 함수 로딩
from ollama_chat import call_ollama_chat, get_ollama_models
from schema import ChatRequest, ChatResponse


# FastAPI 객체 생성
app = FastAPI(
    title="Local LLM Chat API",
    description="Ollama 기반 로컬 LLM 채팅 백엔드 API",
    version="0.1.0",
)

# /chat API 구현
@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    # 비즈니스 로직처리
    # return_value = {
    #     "model": "aaaa",
    #     "ai_message": "ai_message",
    #     "걸린시간" : "걸린시간"
    # }
    try:

      return_value = call_ollama_chat(
              message=request.message,
              model=request.model,
              system_prompt=request.system_prompt,
              temperature=request.temperature,
              top_p=request.top_p,
              num_predict=request.num_predict,
          )


      return return_value
    except Exception as exc:
      raise HTTPException(
          status_code=500,
          detail=f"채팅 처리 중 오류가 발생했습니다: {exc}"
      ) 

# model 목록 가져오기
# http://localhost:8000/models
@app.get("/models")
def list_models():
    try:
       print("진입")
       models = get_ollama_models()
       print(models)
       return {"models": models}
    except Exception as exc:
       raise HTTPException(
          status_code = 500,
          detail = f"모델 목록 조회 중 오류가 발생했습니다.: {exc}"
       )

# uv run main.py
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )