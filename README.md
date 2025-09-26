# MCP Agent Demo — Natural Language to SQL Platform

<div align="center">
  <h3>AI-Powered SQL assistant with MCP integration, embedding-aware planning, and training telemetry</h3>

<a href="https://nextjs.org/" target="_blank"><img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js" /></a>
<a href="https://www.typescriptlang.org/" target="_blank"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript" /></a>
<a href="https://nodejs.org/" target="_blank"><img alt="Node.js" src="https://img.shields.io/badge/Node.js-18-green?style=for-the-badge&logo=node.js" /></a>
<a href="https://modelcontextprotocol.io/" target="_blank"><img alt="MCP" src="https://img.shields.io/badge/MCP-Protocol-purple?style=for-the-badge" /></a>

</div>

## Overview

MCP Agent Demo turns natural language into executable SQL, routes database work through the Model Context Protocol, and keeps the whole experience observable. The platform now couples tool planning with an embedding service, persists end-to-end interactions for training, and exposes rich configuration controls in the UI.

### Core Capabilities

- **Provider Flexibility** – Deepseek, Google Gemini, or any custom HTTP-compatible LLM.
- **Tool-First Planner** – Optional planner ranks MCP tools with embeddings before falling back to raw SQL generation.
- **Schema + Tool Snapshots** – `reports/schema.summary.json` and `reports/toolset.snapshot.json` drive schema awareness and embedding syncs.
- **Training Telemetry** – Every request/response pair (prompt, SQL, execution result, usage, etc.) can be logged to MongoDB for downstream fine-tuning.
- **Configurable UI & API** – Frontend configuration tab and `/api/config` endpoints keep providers, prompts, and toolset switches in sync; `/api/config/embed-sync` pushes snapshots to the embedding service on demand.
- **Debuggable Flow** – Full planner traces, raw model outputs, execution metadata, and CSV usage reports make it easy to inspect behaviour.

## Architecture

```mermaid
sequenceDiagram
    participant UI as Web UI (Next.js)
    participant BE as Backend (Express API)
    participant Embed as Embedding Service (FastAPI)
    participant LLM as SQL Model (Deepseek/Gemini/Custom)
    participant MCP as MCP Toolbox
    participant DB as Target MySQL
    participant Mongo as Training Logs (MongoDB)

    UI->>BE: POST /api/generate { prompt, provider?, useToolset? }

    alt Toolset enabled
        BE->>Embed: POST /rank/tools \| /rank/tables
        Embed-->>BE: Ranked tools + table hints
        BE->>LLM: Planner prompt (tool definitions + schema)

        alt Planner chooses tool
            BE->>MCP: callTool(toolName, args)
            MCP->>DB: Execute tool action
            DB-->>MCP: Rows / effect
            MCP-->>BE: Tool result
        else Planner falls back
            BE->>LLM: Generate SQL
            BE->>MCP: mysql_execute_sql
            MCP->>DB: Run SQL
            DB-->>MCP: Rows / error
            MCP-->>BE: SQL result / error
        end

    else Toolset disabled
        BE->>LLM: Generate SQL
        BE->>MCP: mysql_execute_sql
        MCP->>DB: Run SQL
        DB-->>MCP: Rows / error
        MCP-->>BE: SQL result / error
    end

    BE->>Mongo: insert training_logs (async best-effort)
    BE-->>UI: Response + debug payloads

```

Optional components (embedding service, MongoDB) are auto-detected—if they’re offline, the core SQL flow still works.

## Repository Layout

```
├── mcp-backend/                    # Express server, MCP + provider orchestration
│   ├── config.json                 # Persisted runtime configuration
│   ├── reports/                    # Schema, toolset snapshots, provider usage CSV
│   ├── scripts/                    # Helper scripts (schema export, toolset export)
│   └── src/
│       ├── controllers/            # Request handlers (config, generate, debug, tools)
│       ├── routes/                 # Express routers
│       ├── services/               # Provider integrations, MCP bridge, embeddings, logs
│       └── db/                     # Mongo connection helper
├── mcp-ui/                         # Next.js 15 App Router frontend
│   ├── src/app/                    # Pages (home view slices: query, config, debug)
│   ├── src/components/home/        # Query panel, results, debug cards, etc.
│   └── src/services/api.ts         # REST client (config, generate, tool calls)
├── tools.yaml                      # MCP toolbox configuration (not committed by default)
├── tools.yaml.example              # Template toolbox configuration
└── README.md
```

## Prerequisites

- **Node.js 18+** and **npm 9+**
- **MCP Toolbox** (toolbox CLI) with access to your database tools
- **MySQL** database reachable by the toolbox
- **Python 3.10+** (only if you plan to run the optional embedding FastAPI service)
- **MongoDB** cluster or local instance (optional, used for training logs)

## Backend Setup (`mcp-backend/`)

1. **Install dependencies**

   ```bash
   cd mcp-backend
   npm install
   ```

2. **Environment variables** – create `.env` with the settings you need:

   ```env
   PORT=3001
   MCP_TOOLBOX_URL=http://127.0.0.1:5000
   MCP_SSE_PATH=/sse

   # Provider credentials (enable what you use)
   GEMINI_API_KEY=...
   GEMINI_MODEL=gemini-1.5-pro
   DEEPSEEK_API_KEY=...
   DEEPSEEK_API_BASE=https://api.deepseek.com
   DEEPSEEK_MODEL=deepseek-chat
   CUSTOM_API_BASE=http://localhost:8002

   # Optional embedding-aware planning
   EMBED_LLM_URL=http://localhost:8004

   # Optional MongoDB training log storage
   MONGO_URI=mongodb+srv://user:pass@cluster.example
   MONGO_DB_NAME=mcp
   MONGO_POOL_SIZE=5
   ```

   - If `EMBED_LLM_URL` is empty the planner still works, but without embedding ranking.
   - If `MONGO_URI` is missing the app skips log persistence (you’ll see a console warning once).

3. **Generate snapshots** (recommended whenever the schema/toolset changes):

   ```bash
   npm run schema:mysql        # writes reports/schema.summary.json
   npm run export:toolset      # writes reports/toolset.snapshot.json
   ```

   These files are served to the LLM and pushed to the embedding service.

4. **Run the server**
   ```bash
   npm run dev   # or npm start for production mode
   ```
   The API listens on `http://localhost:3001` by default.

### Optional Embedding Service

Tool ranking expects a FastAPI service that exposes:

- `POST /embed` – body `{ "texts": string[] }`
- `POST /rank/tools` – body `{ "prompt": string, "limit"?: number }`
- `POST /rank/tables`
- `PUT /config/toolset` / `PUT /config/schema`
- `GET /toolset/info`

The repo assumes you are running the companion service described in the local development notes (e.g., SentenceTransformer-based embedding or your own implementation). Start it and set `EMBED_LLM_URL` to its base URL (no trailing slash). Use `/api/config/embed-sync` from the UI or backend to push the latest snapshots.

### Training Logs

If MongoDB is configured the backend writes documents to the `training_logs` collection with:

- `prompt`, `modelOutput`, `sql`, `executionResult`
- Provider/strategy metadata, tool call details
- Error info, usage tokens, request duration

The write is best-effort and runs after each response; failures are logged to the console without impacting the HTTP response.

## Frontend Setup (`mcp-ui/`)

1. **Install dependencies**

   ```bash
   cd mcp-ui
   npm install
   ```

2. **Configure API base** – create `.env.local` if you need to customise it.

   ```env
   NEXT_PUBLIC_API_BASE=http://localhost:3001
   ```

3. **Run the app**
   ```bash
   npm run dev
   ```
   Visit [http://localhost:3000](http://localhost:3000) and toggle between the Query, Results, and Config sections.

## Working with MCP & Toolsets

- Define your MCP tools in `tools.yaml` (copy from `tools.yaml.example`).
- Start the toolbox (`toolbox --ui`) so the backend can list tools and execute them.
- The query panel contains a **“Prefer MCP tool execution”** toggle; either state is sent with the `POST /api/generate` request so you can experiment without touching persisted config.
- The Config tab lets you edit system prompt, default provider, and toolset flags. Saving updates `config.json` and triggers an embedding sync when possible.

## Key API Endpoints

| Method & Path                 | Description                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/generate`          | Main entry point: accepts `{ prompt, provider?, model?, useToolset?, schema? }` and returns SQL, execution results, planner info, raw model output, etc. |
| `GET /api/config`             | Fetch combined config plus embedding status (if configured).                                                                                             |
| `PUT /api/config`             | Persist configuration changes; automatically pushes schema/tool snapshots to the embedding service.                                                      |
| `POST /api/config/embed-sync` | Manually push the latest schema/toolset snapshots to the embedding service.                                                                              |
| `GET /tools`                  | List current MCP tools detected via the toolbox.                                                                                                         |
| `POST /tool`                  | Invoke an MCP tool directly with arbitrary arguments (used by the UI debug tab).                                                                         |
| `POST /debug/toggle`          | Toggle verbose debug mode (streamed planner/tool info).                                                                                                  |

## Observability & Reports

- `mcp-backend/reports/deepseek_usage.csv` – provider token usage appended by `updateUsageCsv`.
- `mcp-backend/reports/schema.summary.json` – latest schema snapshot consumed by the LLM and embedding service.
- `mcp-backend/reports/toolset.snapshot.json` – exported tool metadata used for embeddings.
- Debug mode surfaces planner decisions, token hints, tool arguments, and raw responses in the UI.

## Development Tips

- The backend uses ES modules; run scripts with `node --loader` defaults (already handled by npm scripts).
- The frontend is built with Next.js 15, React 19, Tailwind CSS v4—most styling lives in component-level class names.
- When modifying schema or tool definitions, regenerate snapshots and run `/api/config/embed-sync` to keep the embedding service aligned.
- MongoDB writes happen on the request path; watch the console for `MongoDB connected for training logs.` to confirm connectivity.

## License

Released under the [MIT License](LICENSE). Contributions and feature ideas are welcome—open an issue or submit a pull request.
