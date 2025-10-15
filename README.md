# MCP Agent Demo — Natural Language to SQL Platform

<div align="center">
  <h3>AI-powered MCP workspace with authentication, conversational SQL, and retrieval-aware planning</h3>

<a href="https://nextjs.org/" target="_blank"><img alt="Next.js" src="https://img.shields.io/badge/Next.js-15.5-black?style=for-the-badge&logo=next.js" /></a>
<a href="https://react.dev/" target="_blank"><img alt="React" src="https://img.shields.io/badge/React-19.1-61DAFB?style=for-the-badge&logo=react&logoColor=222222" /></a>
<a href="https://www.typescriptlang.org/" target="_blank"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white" /></a>
<a href="https://tailwindcss.com/" target="_blank"><img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-4.1-38BDF8?style=for-the-badge&logo=tailwindcss&logoColor=white" /></a>
<a href="https://nodejs.org/" target="_blank"><img alt="Node.js" src="https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js&logoColor=white" /></a>
<a href="https://expressjs.com/" target="_blank"><img alt="Express" src="https://img.shields.io/badge/Express-5.1-000000?style=for-the-badge&logo=express&logoColor=white" /></a>
<a href="https://www.prisma.io/" target="_blank"><img alt="Prisma" src="https://img.shields.io/badge/Prisma-6.17-2D3748?style=for-the-badge&logo=prisma&logoColor=white" /></a>
<a href="https://www.postgresql.org/" target="_blank"><img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-15-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" /></a>
<a href="https://www.mongodb.com/" target="_blank"><img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-7-47A248?style=for-the-badge&logo=mongodb&logoColor=white" /></a>
<a href="https://modelcontextprotocol.io/" target="_blank"><img alt="MCP" src="https://img.shields.io/badge/MCP-Protocol-7F56D9?style=for-the-badge" /></a>

</div>

## Overview

MCP Agent Demo turns natural language into SQL while routing work through the Model Context Protocol toolbox. The current release adds organization-aware authentication, persistent chat sessions, saved prompt management, and retrieval-augmented hints that keep planner decisions grounded in indexed entities. The backend continues to log complete training telemetry and orchestrate DeepSeek, Gemini, or custom LLM providers, while the frontend exposes configuration, tooling, and debugging controls in a single workspace.

### Core Capabilities

- **Provider Flexibility** – DeepSeek, Google Gemini, or any custom HTTP-compatible LLM with per-request override from the UI.
- **Tool-First Planner** – Embedding-backed planner ranks MCP tools, applies argument defaults, and only falls back to raw SQL when no tool fits.
- **Retrieval Hints for RAG** – Optional entity retrieval service indexes domain terms (locations, device names, etc.) and feeds filter hints into both the planner and SQL generation pipeline.
- **Authentication & Org Context** – JWT-secured API with admin bootstrap, company/branch hierarchy, and requester metadata captured for every generation.
- **Conversational Workspace** – Chat sessions, history, saved prompts, bulk-insert tooling, and planner debug panels are all available once authenticated.
- **Training Telemetry & Observability** – Every request flows into MongoDB with schema provenance, tool usage, and raw model output; CSV usage reports and planner traces are one click away in debug mode.

## Architecture

```mermaid
sequenceDiagram
    participant User as Authenticated User
    participant UI as Web UI (Next.js)
    participant BE as Backend (Express API)
    participant Auth as MongoDB Auth Models
    participant Embed as Embedding / Retrieval Service (FastAPI)
    participant LLM as SQL Model (Deepseek/Gemini/Custom)
    participant MCP as MCP Toolbox
    participant DB as Target PostgreSQL
    participant Mongo as Training Logs (MongoDB)

    User->>UI: Login (JWT stored in browser)
    UI->>BE: Authenticated REST (Bearer token)
    BE->>Auth: validate token / load user context

    UI->>BE: POST /api/generate { prompt, toolset?, useRagHints? }
    alt Toolset enabled
        BE->>Embed: POST /rank/tools
        BE->>Embed: POST /entities/search (optional)
        Embed-->>BE: Ranked tools + entity hints
        BE->>LLM: Planner prompt (tools + schema + hints)

        alt Planner chooses tool
            BE->>MCP: callTool(toolName, args)
            MCP->>DB: Execute tool action
            DB-->>MCP: Rows / effect
            MCP-->>BE: Tool result
        else Planner falls back
            BE->>LLM: Generate SQL (with entity hints)
            BE->>MCP: postgres_execute_sql
            MCP->>DB: Run SQL
            DB-->>MCP: Rows / error
            MCP-->>BE: SQL result / error
        end
    else Toolset disabled
        BE->>LLM: Generate SQL (optional RAG hints)
        BE->>MCP: postgres_execute_sql
        MCP->>DB: Run SQL
        DB-->>MCP: Rows / error
        MCP-->>BE: SQL result / error
    end

    BE->>Mongo: Persist training_logs (prompt + output + metadata)
    BE-->>UI: Response + debug payloads + session updates
```

Optional components (embedding service, entity retrieval, MongoDB analytics) are auto-detected—if they’re offline, the core SQL flow still works once authentication succeeds.

## Repository Layout

```
├── mcp-backend/                      # Express API + MCP orchestration
│   ├── Dockerfile
│   ├── prisma/                       # Prisma schemas (Postgres + Mongo)
│   │   ├── schema.prisma
│   │   └── mongo.prisma
│   ├── reports/                      # Generated snapshots (schema, toolset, usage, logs)
│   ├── scripts/
│   │   ├── create-admin.js           # Seed the first admin user via env vars
│   │   ├── export-prisma-schema.js   # Refresh Prisma schema + schema bundle
│   │   └── export-logs.js            # Dump MongoDB training logs to reports/
│   └── src/
│       ├── app/                      # Express bootstrap (server + start)
│       ├── controllers/              # Auth, generate, tools, prompts, sessions, debug
│       ├── db/                       # Mongo connection helpers
│       ├── middleware/               # JWT auth guards
│       ├── models/                   # Users, companies, branches, prompts, sessions
│       ├── routes/                   # REST routes (auth, generate, retrieval, tools, etc.)
│       ├── services/                 # LLM providers, planner, embeddings, MCP bridge
│       └── utils/                    # Auth helpers, env loader, response helpers
├── mcp-ui/                           # Next.js 15 workspace
│   ├── Dockerfile
│   ├── src/app/                      # Routes (login, workspace)
│   ├── src/components/home/          # Chat/query/history UI building blocks
│   └── src/services/api.ts           # Frontend REST client (auth, sessions, prompts, tools)
├── config/tools.yaml                 # MCP toolbox definition mounted into the toolbox container
├── models/gpt20_api.py               # Example FastAPI wrapper for a custom SQL LLM
├── docker-compose.yml
└── README.md
```

## Prerequisites

- **Node.js 20+** and **npm 9+** (matches the Docker images shipped in this repo)
- **MCP Toolbox** CLI configured with access to your target PostgreSQL instance
- **PostgreSQL** reachable both from the toolbox and from the backend
- **MongoDB** for authentication, sessions, prompts, and training logs
- **Python 3.10+** only if you plan to run the optional FastAPI embedding/retrieval service
- A strong **JWT secret** for signing API tokens (`JWT_SECRET`)

## Backend Setup (`mcp-backend/`)

1. **Install dependencies**

   ```bash
   cd mcp-backend
   npm install
   ```

2. **Create `.env`** – copy from `.env.example` and fill in required secrets. At minimum you need a JWT secret, provider credentials, and either `DATABASE_URL` or the individual `POSTGRES_*` variables.

   ```env
   NODE_ENV=development
   PORT=3001
   CORS_ORIGIN=http://localhost:3000

   PROMPT_COMPLETION_PROVIDER=deepseek
   DEEPSEEK_API_KEY=sk-...
   GEMINI_API_KEY=
   CUSTOM_API_BASE=
   CUSTOM_API_TIMEOUT_MS=10000

   MCP_TOOLBOX_URL=http://localhost:5173/.well-known/mcp/toolbox/sse
   MCP_SSE_PATH=/.well-known/mcp/toolbox/sse
   EMBED_LLM_URL=                   # optional embedding/retrieval service

   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_USER=mcp
   POSTGRES_PASSWORD=mcp
   POSTGRES_DB=mcp
   DATABASE_URL=postgresql://mcp:mcp@localhost:5432/mcp

   MONGO_URI=mongodb://localhost:27017/mcp
   MONGO_DB_NAME=mcp

   JWT_SECRET=super-secret-string
   USE_RAG_HINTS=true

   ADMIN_NAME="Sistem Yöneticisi"
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=Admin123!
   COMPANY_NAME=DefaultCo
   BRANCH_NAME=HQ
   ```

3. **Generate schema & tool snapshots**

   ```bash
   npm run export:prisma:schema    # writes reports/prisma.schema.prisma + schema.bundle.txt
   npm run export:toolset          # writes reports/toolset.snapshot.json (toolbox must be running)
   ```

   Re-run these scripts whenever the database schema or toolbox definitions change so the planner and embeddings stay up to date.

4. **Bootstrap authentication**

   ```bash
   npm run create:admin
   ```

   The script reads the `ADMIN_*` and organisation variables from your environment and seeds the first admin user in MongoDB. After an admin exists, new admins must authenticate before running the script or calling `POST /auth/admin`.

5. **(Optional) Seed organizations & users**

   - `POST /auth/companies` to create organizations (admin only)
   - `POST /auth/branches` to attach branches to companies
   - `POST /auth/users` to invite additional analysts tied to those branches
     The `/auth/me` endpoint echoes the authenticated user and organization context; this metadata is logged alongside each generation.

6. **Run the server**
   ```bash
   npm run dev   # or npm start for production mode
   ```
   The API listens on `http://localhost:3001` by default.

### Tool Planner, Retrieval & Snapshots

- Planner requests read from `reports/prisma.schema.prisma`, fall back to `reports/schema.bundle.txt`, and finally `reports/schema.summary.json` if present. Keep these snapshots current to improve planner accuracy.
- The embedding service configured via `EMBED_LLM_URL` should expose:
  - `POST /rank/tools`
  - `POST /rank/tables`
  - `POST /embed`
  - `POST /entities/search`
  - `GET /toolset/info` (optional health/metadata probe)
- Refresh the snapshots on disk with `npm run export:prisma:schema` and `npm run export:toolset` as your schema or toolbox changes; the backend reads them lazily at runtime.

### Entity Retrieval & RAG Hints

- Set `EMBED_LLM_URL` to an embedding/retrieval API that provides `/rank/tools`, `/rank/tables`, `/embed`, and `/entities/search`. If it is unset, the planner simply skips embedding-powered hints.
- Populate `reports/entities.json` with domain-specific entities (locations, devices, etc.) and index them into your retrieval service using your own data pipeline. The backend will include the top matches when RAG hints are enabled.
- Toggle **RAG Hints** in the UI header (or pass `useRagHints` in `POST /api/generate`) to inject entity hints into the planner and SQL generation prompts.

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

Visit [http://localhost:3000](http://localhost:3000) and log in with the admin/user credentials you created. The workspace exposes:

- Chat, Query, Tools, Bulk Insert, and History tabs via the left sidebar
- Model selector (DeepSeek, Gemini, Custom) and toggles for Debug + RAG hints
- Session list with rename/delete actions and automatic persistence
- Saved prompt library with export-friendly formatting

## Working with MCP & Toolsets

- Define your MCP tools in `config/tools.yaml`. The docker-compose stack mounts this file into the toolbox container.
- Start the toolbox (`toolbox --ui` or your preferred launch command) so the backend can list tools and execute them.
- The chat/query panels include a **“Toolset”** toggle that maps to `useToolset` on `POST /api/generate`, letting you compare planner-driven tool usage versus direct SQL.
- Saved sessions capture planner summaries, tool calls, SQL text, execution results, and debug payloads—handy for audits or fine-tuning data collection.

## Key API Endpoints

| Method & Path                              | Description                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                              | Lightweight health probe.                                                                                                               |
| `POST /auth/admin`                         | Bootstrap the first admin user (requires an admin token after the first run).                                                           |
| `POST /auth/login`                         | Username/password login; returns `{ token, user }`.                                                                                      |
| `GET /auth/me`                             | Return the authenticated user with company/branch context.                                                                              |
| `POST /auth/companies` / `GET /auth/companies` | Create or list companies (create requires admin).                                                                                   |
| `POST /auth/branches` / `GET /auth/branches` | Create or list branches (create requires admin).                                                                                    |
| `POST /auth/users` / `GET /auth/users`     | Invite or list additional users (admin only).                                                                                           |
| `POST /api/generate`                       | Main entry point: accepts `{ prompt, provider?, model?, useToolset?, useRagHints?, schema? }` and returns SQL/tool output.               |
| `GET /tools` / `POST /tool`                | List or invoke MCP tools directly (admin only).                                                                                          |
| `GET /prompts` / `POST /prompts`           | Saved prompt library operations for the authenticated user.                                                                             |
| `GET /sessions` / `POST /sessions`         | List or create chat sessions for the logged-in user.                                                                                    |
| `POST /sessions/:id/messages`              | Append conversation turns to a session.                                                                                                 |
| `PATCH /sessions/:id` / `DELETE /sessions/:id` | Rename or delete a chat session.                                                                                                    |
| `GET /debug/status` / `POST /debug/toggle` | Inspect or change verbose debug mode (admin only).                                                                                      |
| `GET /retrieval/search`                    | Proxy to the embedding service for entity search; accepts `query`, optional `types`, and `limit`.                                       |
| `GET /schema/bundle`                       | Download the most recent Prisma schema bundle generated by `export:prisma:schema`.                                                      |

## Observability & Reports

- `mcp-backend/reports/prisma.schema.prisma` – snapshot produced by `npm run export:prisma:schema`.
- `mcp-backend/reports/schema.bundle.txt` – Prisma schema + Postgres views in one file (also from `export:prisma:schema`).
- `mcp-backend/reports/schema.summary.json` – optional hand-curated summary consumed by the planner when present.
- `mcp-backend/reports/toolset.snapshot.json` – exported MCP tool metadata (`npm run export:toolset`).
- `mcp-backend/reports/deepseek_usage.csv` – provider token usage appended by `updateUsageCsv`.
- `mcp-backend/reports/entities.json` – optional entity export you can manage manually for retrieval hints.
- `mcp-backend/reports/training_logs.*.json` – archives produced by `node scripts/export-logs.js`.
- MongoDB collections `training_logs`, `sessions`, `saved_prompts`, `users`, `companies`, and `branches` provide end-to-end observability.

Enable debug mode from the UI header or `/debug/toggle` to stream planner traces, token counts, tool arguments, and SQL execution payloads.

## Development Tips

- The backend uses ES modules; npm scripts already pass the correct loader flags.
- When the database schema or tool definitions change, rerun `npm run export:prisma:schema` and `npm run export:toolset` while the toolbox is reachable so embeddings stay current.
- MongoDB connectivity is required for login; watch the console for `MongoDB connected` logs to confirm.
- Entity retrieval is best-effort—if the embedding service is offline, the planner falls back gracefully while logging a warning.

## License

Released under the [MIT License](LICENSE). Contributions and feature ideas are welcome—open an issue or submit a pull request.

## Docker (Backend + MongoDB + postgres)

1. Build and run services:

   ```bash
   docker compose up -d --build
   ```

2. Environment:

   - The compose file wires sensible defaults. To override secrets (e.g., `DEEPSEEK_API_KEY`, `JWT_SECRET`), export them in your shell before running compose or create a `.env` file in the repo root with those variables.
   - Backend connects to services by name: `postgres` and `mongo`.

3. Access:

   - Backend API: `http://localhost:3001`
   - PostgreSQL: `localhost:5432` (user `mcp` / pass `mcp` / db `mcp`)
   - MCP Toolbox UI (optional): `http://localhost:5173`
   - MongoDB: `localhost:27017`

4. First-time setup inside Docker:

   ```bash
   # Generate schema snapshot and toolset (optional but recommended)
   docker compose exec backend npm run export:prisma:schema
   docker compose exec backend npm run export:toolset

   # Create initial admin
   docker compose exec backend npm run create:admin
   ```

5. Logs:

   ```bash
   docker compose logs -f backend
   ```

6. Stop & clean up:
   ```bash
   docker compose down
   # remove volumes if you want a clean state
   docker compose down -v
   ```
