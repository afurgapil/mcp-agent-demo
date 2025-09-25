MCP Agent Demo — Node.js HTTP API

Overview

- Express 5 server exposing endpoints to interact with an MCP Toolbox and generate SQL using Deepseek.
- Modular structure: src/app, src/routes, src/controllers, src/services, src/utils.

Requirements

- Node.js 18+ (uses built-in fetch)
- An MCP Toolbox reachable via SSE (MCP_TOOLBOX_URL)
- Deepseek API key

Setup

1. Configure .env

2. Install dependencies

   - npm i

3. Run
   - npm run dev
   - or: npm start

Notes

- Security: All tools are allowed by default. If you need an allowlist, you can add it later.
- Error handling: The server returns JSON errors with proper status codes.
- Reports: runtime artifacts are written under reports/.

MySQL minimal schema generator

- Purpose: produce a compact JSON schema (tables, columns, PK, single-column UNIQUE, FKs) for low-token prompts.
- Dependency: mysql2

Env vars (required)

- MYSQL_HOST (default 127.0.0.1)
- MYSQL_PORT (default 3306)
- MYSQL_USER
- MYSQL_PASSWORD
- MYSQL_DATABASE
- SCHEMA_MINIFY=true|false (default true)

Usage

1. Install deps: npm i
2. Set env (e.g. via .env)
3. Run:
   npm run schema:mysql

Output shape (example)

```json
{
  "version": "2025-09-25",
  "dialect": "mysql",
  "database": "exampledb",
  "tables": [
    {
      "name": "users",
      "columns": [
        { "name": "id", "type": "bigint", "pk": true },
        { "name": "email", "type": "varchar", "unique": true },
        { "name": "created_at", "type": "timestamp" }
      ],
      "fks": []
    }
  ]
}
```
