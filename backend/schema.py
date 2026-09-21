from pydantic import BaseModel, Field

# ChatRequest 모델 설계
class ChatRequest(BaseModel):
    message: str = Field(..., description="사용자가 입력한 질문")
    model: str = Field(default="exaone3.5:7.8b", description="Ollama 모델명")
    system_prompt: str = Field(
        default="너는 초보자를 돕는 친절한 AI 강사다.",
        description="모델의 역할을 지정하는 시스템 프롬프트",
    )
    temperature: float = Field(default=0.6, ge=0.0, le=2.0)
    top_p: float = Field(default=0.7, ge=0.0, le=1.0)
    num_predict: int = Field(default=256, ge=1, le=2048)

# ChatResponse 모델 설계
class ChatResponse(BaseModel):
    model: str
    message: str
    elapsed_time: float