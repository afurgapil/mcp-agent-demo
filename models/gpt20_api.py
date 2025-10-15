# 🔧 GLOBAL CONFIG
SYSTEM_PROMPT = "You are an expert SQL engineer. Receive natural language questions together with the database schema and reply with a SQL statement that can be executed directly against the database. Output only the SQL statement without explanations or markdown fences. Use the schema exactly as provided."

MAX_TOKENS = 2048
TEMPERATURE= 0
TOP_P=0.8
REPEAT_PENALTY=1.5

# 🔧 FastAPI App
app = FastAPI(
    title="GGUF SQL API",
    version="1.0",
    description="GGUF tabanlı LLM ile SQL üretim API'si",
)

# 🔧 GGUF Model Path (Değiştirilebilir)
GGUF_MODEL_PATH = "/home/barfas/Desktop/sql-model/models/gpt-oss-20b-Q5_K_M.gguf"

# 🚀 Model yüklemesi
logger.info("🔄 GGUF Model yükleniyor...")
llm = Llama(
    model_path=GGUF_MODEL_PATH,
    n_ctx=16384,
    n_threads=8, # CPU thread sayısı (gerekirse arttır)
    n_gpu_layers=20, # GPU hızlandırma (eğer destekliyorsa)
    verbose=False
)
logger.info("✅ GGUF model yüklendi.")

# 📥 İstek modeli
class GenerateRequest(BaseModel):
    message: str = Field(..., example="Son 30 gün içinde alışveriş yapan müşteriler kimler?")
    system_prompt: Optional[str] = Field(None, description="İstek bazlı sistem prompt")
    schema: Optional[str] = Field(None, description="İstek bazlı DB şeması (JSON veya metin)")

# 📤 Yanıt modeli
class ChatResponse(BaseModel):
    response: str

# 📥 Config güncelleme modeli
class UpdateConfigRequest(BaseModel):
    system_prompt: Optional[str] = None
    schema: Optional[str] = None

# 📤 Config yanıt modeli
class ConfigResponse(BaseModel):
    system_prompt: str
    schema: str

# ✅ SQL Üretimi
@app.post("/api/generate", response_model=ChatResponse, tags=["Chat"])
def generate_sql(req: GenerateRequest):
    logger.info("📨 Yeni SQL isteği: %s", req.message)
    active_schema = req.schema if (req.schema and req.schema.strip()) else DB_SCHEMA
    active_system_prompt = (
        req.system_prompt if (req.system_prompt and req.system_prompt.strip()) else SYSTEM_PROMPT
    )
    logger.info("📨 Aktif şema uzunluğu: %d", len(active_schema or ""))
    logger.info("📨 Aktif system prompt uzunluğu: %d", len(active_system_prompt or ""))
    prompt = f"""<|system|>
{active_system_prompt}

<|user|>
Soru:
{req.message}

{active_schema}
<|assistant|>"""

    start = time.perf_counter()

    output = llm(
        prompt,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        top_p=TOP_P,
        repeat_penalty=REPEAT_PENALTY,
        stop=["<|user|>", "<|system|>"]
    )

    end = time.perf_counter()
    result = output["choices"][0]["text"]
    result = re.sub(r"^(assistant|Assistant):", "", result, flags=re.IGNORECASE).strip()

    logger.info("✅ Yanıt süresi: %.2f ms", (end - start) * 1000)
    return {"response": result}

