# 🔧 GLOBAL CONFIG
SYSTEM_PROMPT = "You are an expert SQL engineer. Receive natural language questions together with the database schema and reply with a SQL statement that can be executed directly against the database. Output only the SQL statement without explanations or markdown fences. Use the schema exactly as provided."

DB_SCHEMA = "{\"version\":\"2025-09-26\",\"dialect\":\"mysql\",\"database\":\"mcp\",\"tables\":[{\"name\":\"device_permissions\",\"engine\":\"InnoDB\",\"row_count\":10,\"columns\":[{\"name\":\"permission_id\",\"type\":\"int\",\"pk\":true,\"precision\":10,\"scale\":0},{\"name\":\"user_id\",\"type\":\"int\",\"precision\":10,\"scale\":0},{\"name\":\"device_id\",\"type\":\"int\",\"precision\":10,\"scale\":0},{\"name\":\"can_view\",\"type\":\"tinyint\",\"nullable\":true,\"default\":\"1\",\"precision\":3,\"scale\":0},{\"name\":\"can_control\",\"type\":\"tinyint\",\"nullable\":true,\"default\":\"0\",\"precision\":3,\"scale\":0}],\"fks\":[{\"column\":\"user_id\",\"refTable\":\"users\",\"refColumn\":\"user_id\"},{\"column\":\"device_id\",\"refTable\":\"devices\",\"refColumn\":\"device_id\"}],\"indexes\":[{\"name\":\"device_id\",\"unique\":false,\"columns\":[\"device_id\"]},{\"name\":\"PRIMARY\",\"unique\":true,\"columns\":[\"permission_id\"]},{\"name\":\"user_id\",\"unique\":false,\"columns\":[\"user_id\"]}],\"joins\":[{\"to\":\"users\",\"on\":[\"device_permissions.user_id = users.user_id\"],\"type\":\"fk\"},{\"to\":\"devices\",\"on\":[\"device_permissions.device_id = devices.device_id\"],\"type\":\"fk\"}]},{\"name\":\"devices\",\"engine\":\"InnoDB\",\"row_count\":20,\"columns\":[{\"name\":\"device_id\",\"type\":\"int\",\"pk\":true,\"precision\":10,\"scale\":0},{\"name\":\"name\",\"type\":\"varchar\",\"maxlen\":100},{\"name\":\"type\",\"type\":\"enum\",\"maxlen\":7,\"enum_values\":[\"camera\",\"sensor\",\"gateway\",\"other\"]},{\"name\":\"location\",\"type\":\"varchar\",\"nullable\":true,\"maxlen\":255},{\"name\":\"status\",\"type\":\"enum\",\"nullable\":true,\"default\":\"active\",\"maxlen\":11,\"enum_values\":[\"active\",\"inactive\",\"maintenance\"]},{\"name\":\"created_at\",\"type\":\"timestamp\",\"nullable\":true,\"default\":\"CURRENT_TIMESTAMP\"}],\"indexes\":[{\"name\":\"PRIMARY\",\"unique\":true,\"columns\":[\"device_id\"]}]},{\"name\":\"locations\",\"engine\":\"InnoDB\",\"row_count\":10,\"columns\":[{\"name\":\"location_id\",\"type\":\"int\",\"pk\":true,\"precision\":10,\"scale\":0},{\"name\":\"name\",\"type\":\"varchar\",\"maxlen\":255},{\"name\":\"address\",\"type\":\"text\",\"nullable\":true,\"maxlen\":65535},{\"name\":\"latitude\",\"type\":\"decimal\",\"nullable\":true,\"precision\":10,\"scale\":8},{\"name\":\"longitude\",\"type\":\"decimal\",\"nullable\":true,\"precision\":11,\"scale\":8},{\"name\":\"created_at\",\"type\":\"timestamp\",\"nullable\":true,\"default\":\"CURRENT_TIMESTAMP\"}],\"indexes\":[{\"name\":\"PRIMARY\",\"unique\":true,\"columns\":[\"location_id\"]}]},{\"name\":\"signal_logs\",\"engine\":\"InnoDB\",\"row_count\":10,\"columns\":[{\"name\":\"log_id\",\"type\":\"bigint\",\"pk\":true,\"precision\":19,\"scale\":0},{\"name\":\"signal_id\",\"type\":\"int\",\"precision\":10,\"scale\":0},{\"name\":\"value\",\"type\":\"varchar\",\"nullable\":true,\"maxlen\":255},{\"name\":\"recorded_at\",\"type\":\"timestamp\",\"nullable\":true,\"default\":\"CURRENT_TIMESTAMP\"}],\"fks\":[{\"column\":\"signal_id\",\"refTable\":\"signals\",\"refColumn\":\"signal_id\"}],\"indexes\":[{\"name\":\"PRIMARY\",\"unique\":true,\"columns\":[\"log_id\"]},{\"name\":\"signal_id\",\"unique\":false,\"columns\":[\"signal_id\"]}],\"joins\":[{\"to\":\"signals\",\"on\":[\"signal_logs.signal_id = signals.signal_id\"],\"type\":\"fk\"}]},{\"name\":\"signals\",\"engine\":\"InnoDB\",\"row_count\":0,\"columns\":[{\"name\":\"signal_id\",\"type\":\"int\",\"pk\":true,\"precision\":10,\"scale\":0},{\"name\":\"device_id\",\"type\":\"int\",\"precision\":10,\"scale\":0},{\"name\":\"signal_type\",\"type\":\"enum\",\"maxlen\":11,\"enum_values\":[\"temperature\",\"motion\",\"video\",\"audio\",\"other\"]},{\"name\":\"value\",\"type\":\"varchar\",\"nullable\":true,\"maxlen\":255},{\"name\":\"unit\",\"type\":\"varchar\",\"nullable\":true,\"maxlen\":50},{\"name\":\"recorded_at\",\"type\":\"timestamp\",\"nullable\":true,\"default\":\"CURRENT_TIMESTAMP\"}],\"fks\":[{\"column\":\"device_id\",\"refTable\":\"devices\",\"refColumn\":\"device_id\"}],\"indexes\":[{\"name\":\"device_id\",\"unique\":false,\"columns\":[\"device_id\"]},{\"name\":\"PRIMARY\",\"unique\":true,\"columns\":[\"signal_id\"]}],\"joins\":[{\"to\":\"devices\",\"on\":[\"signals.device_id = devices.device_id\"],\"type\":\"fk\"}]},{\"name\":\"users\",\"engine\":\"InnoDB\",\"row_count\":10,\"columns\":[{\"name\":\"user_id\",\"type\":\"int\",\"pk\":true,\"precision\":10,\"scale\":0},{\"name\":\"username\",\"type\":\"varchar\",\"unique\":true,\"maxlen\":100},{\"name\":\"email\",\"type\":\"varchar\",\"unique\":true,\"maxlen\":150},{\"name\":\"role\",\"type\":\"enum\",\"nullable\":true,\"default\":\"viewer\",\"maxlen\":8,\"enum_values\":[\"admin\",\"operator\",\"viewer\"]},{\"name\":\"created_at\",\"type\":\"timestamp\",\"nullable\":true,\"default\":\"CURRENT_TIMESTAMP\"}],\"indexes\":[{\"name\":\"email\",\"unique\":true,\"columns\":[\"email\"]},{\"name\":\"PRIMARY\",\"unique\":true,\"columns\":[\"user_id\"]},{\"name\":\"username\",\"unique\":true,\"columns\":[\"username\"]}]}]}"
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

