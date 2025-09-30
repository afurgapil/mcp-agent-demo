import logging
import re
import time
from typing import Optional

import torch
from fastapi import FastAPI
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

# 🔧 Logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



MAX_TOKENS = 1000
TEMPERATURE = 0.0
TOP_P = 0.8
REPEAT_PENALTY = 1.5  # transformers -> repetition_penalty

# 🔧 FastAPI App (aynı endpoint'ler)
app = FastAPI(
    title="HF SQL API",
    version="1.0",
    description="Transformers tabanlı LLM ile SQL üretim API'si",
)

# 🔧 MODEL (sadece model farklı)
MODEL_NAME = "mistralai/Mistral-7B-Instruct-v0.3"
logger.info("🔄 HF model yükleniyor...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME,
    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    device_map="auto",
)
logger.info("✅ HF model yüklendi.")

# 📥 İstek modeli (aynı)
class GenerateRequest(BaseModel):
    message: str = Field(
        ..., example="Son 30 gün içinde alışveriş yapan müşteriler kimler?"
    )
    system_prompt: Optional[str] = None
    schema: Optional[str] = None

# 📤 Yanıt modeli (aynı: { response: str })
class ChatResponse(BaseModel):
    response: str

# 📥 Config update modeli (aynı)
class UpdateConfigRequest(BaseModel):
    system_prompt: Optional[str] = None
    schema: Optional[str] = None

# 📤 Config yanıt modeli (aynı)
class ConfigResponse(BaseModel):
    system_prompt: str
    schema: str

def _build_prompt(user_message: str, system_prompt: str, schema_text: str) -> str:
    # Birinci API’deki formatla aynı özel tag’ler
    return f"""<|system|>
{system_prompt}

<|user|>
Soru:
{user_message}

{schema_text}
<|assistant|>"""

def _apply_stops(text: str, stops: list[str]) -> str:
    cut = len(text)
    for s in stops:
        idx = text.find(s)
        if idx != -1:
            cut = min(cut, idx)
    return text[:cut]

# ✅ SQL Üretimi (aynı endpoint ve response alan adı)
@app.post("/api/generate", response_model=ChatResponse, tags=["Chat"])
def generate_sql(req: GenerateRequest):
    logger.info("📨 Yeni SQL isteği: %s", req.message)
    active_schema = req.schema.strip() if req.schema else DB_SCHEMA
    active_system = (
        req.system_prompt.strip() if req.system_prompt else SYSTEM_PROMPT
    )
    logger.info("📘 Aktif DB_SCHEMA uzunluğu: %d", len(active_schema))
    logger.info(
        "🧠 SYSTEM_PROMPT: %s",
        active_system[:200] + ("..." if len(active_system) > 200 else ""),
    )

    prompt = _build_prompt(req.message, active_system, active_schema)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    start = time.perf_counter()
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=MAX_TOKENS,
            do_sample=bool(TEMPERATURE and TEMPERATURE > 0),
            temperature=max(TEMPERATURE, 0.0001),  # 0 ise greedy'e çok yakın
            top_p=TOP_P,
            repetition_penalty=REPEAT_PENALTY,
            eos_token_id=tokenizer.eos_token_id,
            pad_token_id=tokenizer.eos_token_id,
        )
    end = time.perf_counter()

    full = tokenizer.decode(outputs[0], skip_special_tokens=True)
    # prompt'u kes
    generated = full[len(tokenizer.decode(inputs["input_ids"][0], skip_special_tokens=True)) :].strip()

    # Birinci API’deki temizlik benzeri
    generated = re.sub(r"^(assistant|Assistant):", "", generated, flags=re.IGNORECASE).strip()
    generated = _apply_stops(generated, ["<|user|>", "<|system|>"]).strip()

    logger.info("✅ Yanıt süresi: %.2f ms", (end - start) * 1000)
    return {"response": generated}

