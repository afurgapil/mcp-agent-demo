import json
import os
import threading
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

# MODEL sabiti: doğru model kullanılıyor
DEFAULT_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

# ---------- API Model Tanımları ----------
class TextsRequest(BaseModel):
    texts: List[str] = Field(..., min_length=1)


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]


class RankRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    limit: int = Field(6, gt=0)


class RankTablesResponse(BaseModel):
    tables: List[dict]


class RankToolsResponse(BaseModel):
    tools: List[dict]
    tableHints: Optional[List[dict]] = None


class ToolsetInfo(BaseModel):
    generatedAt: Optional[str]
    count: int
    model: str


# ---------- Ana State Sınıfı ----------
class EmbeddingState:
    def __init__(self):
        self.model: Optional[SentenceTransformer] = None
        self.generated_at: Optional[str] = None
        self.tools: List[dict] = []
        self.tables: List[dict] = []
        self.tool_embeddings: Optional[np.ndarray] = None
        self.table_embeddings: Optional[np.ndarray] = None
        self._lock = threading.RLock()

    def load_model(self):
        if self.model is None:
            self.model = SentenceTransformer(DEFAULT_MODEL_NAME)

    def set_toolset(self, data: dict):
        self.load_model()
        with self._lock:
            tools = data.get("tools") or []
            if not isinstance(tools, list):
                raise ValueError("Toolset must be a list under key 'tools'")
            self.generated_at = data.get("generatedAt")
            self.tools = tools
            self.tool_embeddings = self.model.encode(
                [tool_to_text(tool) for tool in tools], convert_to_numpy=True
            )

    def set_schema(self, data: dict):
        self.load_model()
        with self._lock:
            tables = data.get("tables") or []
            results = []
            for table in tables:
                name = table.get("name")
                if not isinstance(name, str) or not name:
                    continue
                columns = table.get("columns") or []
                col_desc = " ".join(
                    f"{col.get('name','')} {col.get('type','')}" for col in columns
                )
                fks = table.get("fks") or []
                fk_desc = " ".join(
                    f"{fk.get('column','')}->{fk.get('refTable','')}" for fk in fks
                )
                text = f"Table {name}\nColumns: {col_desc}\nFK: {fk_desc}"
                results.append({"name": name, "text": text})
            self.tables = results
            if results:
                self.table_embeddings = self.model.encode(
                    [entry["text"] for entry in results], convert_to_numpy=True
                )
            else:
                self.table_embeddings = None

    def ensure_loaded(self):
        with self._lock:
            if not self.model:
                self.load_model()

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        self.ensure_loaded()
        vectors = self.model.encode(texts, convert_to_numpy=True)
        return vectors.tolist()

    def rank_tables(self, prompt: str, limit: int) -> List[dict]:
        self.ensure_loaded()
        if self.table_embeddings is None or not len(self.tables):
            return []
        prompt_vec = self.model.encode([prompt], convert_to_numpy=True)[0]
        scores = cosine_similarity_matrix(prompt_vec, self.table_embeddings)
        order = np.argsort(scores)[::-1][:limit]
        return [
            {
                "name": self.tables[idx]["name"],
                "score": float(scores[idx]),
            }
            for idx in order
        ]

    def rank_tools(
        self, prompt: str, limit: int
    ) -> tuple[List[dict], List[dict]]:
        self.ensure_loaded()
        prompt_vec = self.model.encode([prompt], convert_to_numpy=True)[0]
        scores = cosine_similarity_matrix(prompt_vec, self.tool_embeddings)
        order = np.argsort(scores)[::-1][: min(limit, len(scores))]
        table_hints = self.rank_tables(prompt, limit=3)
        primary_table = table_hints[0]["name"] if table_hints else None

        results = []
        for idx in order:
            tool = self.tools[idx]
            entry = {
                "name": tool.get("name"),
                "description": tool.get("description"),
                "score": float(scores[idx]),
                "inputSchema": tool.get("inputSchema"),
            }
            suggested_args = build_argument_suggestions(tool, primary_table)
            if suggested_args:
                entry["argumentSuggestions"] = suggested_args
            results.append(entry)
        return results, table_hints

    def info(self) -> ToolsetInfo:
        self.ensure_loaded()
        return ToolsetInfo(
            generatedAt=self.generated_at,
            count=len(self.tools),
            model=DEFAULT_MODEL_NAME,
        )


# ---------- Yardımcı Fonksiyonlar ----------
def tool_to_text(tool: dict) -> str:
    parts = [tool.get("name", ""), tool.get("description", "")]
    schema = tool.get("inputSchema") or {}
    properties = schema.get("properties") or {}
    for key, meta in properties.items():
        if not isinstance(meta, dict):
            continue
        desc = meta.get("description") or meta.get("type") or ""
        parts.append(f"{key}: {desc}")
    required = schema.get("required")
    if isinstance(required, list) and required:
        parts.append("required=" + ", ".join(required))
    return "\n".join(filter(None, parts))


def build_argument_suggestions(tool: dict, primary_table: Optional[str]):
    schema = tool.get("inputSchema") or {}
    properties = schema.get("properties") or {}
    if not isinstance(properties, dict):
        return None
    suggestions = {}
    if primary_table:
        for candidate in ("tableName", "table", "table_name"):
            if candidate in properties and candidate not in suggestions:
                suggestions[candidate] = primary_table
    if "limit" in properties and "limit" not in suggestions:
        suggestions["limit"] = 50
    if "offset" in properties and "offset" not in suggestions:
        suggestions["offset"] = 0
    return suggestions or None


def cosine_similarity_matrix(vec: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    vec_norm = np.linalg.norm(vec) + 1e-12
    mat_norms = np.linalg.norm(matrix, axis=1) + 1e-12
    return np.dot(matrix, vec) / (vec_norm * mat_norms)


# ---------- FastAPI Uygulaması ----------
state = EmbeddingState()
app = FastAPI(title="Toolset Embedding Service", version="0.2.0")


@app.on_event("startup")
def startup_event():
    state.ensure_loaded()


@app.post("/embed", response_model=EmbedResponse)
def embed_texts(request: TextsRequest):
    embeddings = state.embed_texts(request.texts)
    return {"embeddings": embeddings}


@app.post("/rank/tools", response_model=RankToolsResponse)
def rank_tools(request: RankRequest):
    tools, table_hints = state.rank_tools(request.prompt, request.limit)
    return {"tools": tools, "tableHints": table_hints}


@app.post("/rank/tables", response_model=RankTablesResponse)
def rank_tables(request: RankRequest):
    tables = state.rank_tables(request.prompt, request.limit)
    return {"tables": tables}


@app.get("/toolset/info", response_model=ToolsetInfo)
def toolset_info():
    return state.info()


# ---------- Config API'leri ----------
@app.get("/config")
def get_config():
    return {
        "model": DEFAULT_MODEL_NAME,
        "toolCount": len(state.tools),
        "tableCount": len(state.tables),
        "generatedAt": state.generated_at,
    }


@app.put("/config/toolset")
def set_toolset(data: dict = Body(...)):
    try:
        state.set_toolset(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "toolCount": len(state.tools)}


@app.put("/config/schema")
def set_schema(data: dict = Body(...)):
    try:
        state.set_schema(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "tableCount": len(state.tables)}