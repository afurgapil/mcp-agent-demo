MCP Agent Demo — Node.js HTTP API

Overview
- Exposes three endpoints to interact with an MCP Toolbox via Gemini planning:
  - GET /tools — list available tools
  - POST /tool — call a tool manually with args
  - POST /nl — natural-language query → Gemini plan → MCP tool → summary

Requirements
- Node.js 18+ (uses built-in fetch)
- An MCP Toolbox running with HTTP endpoints at /tools and /call/:name
- Google AI Studio API key

Setup
1) Configure .env
   - GEMINI_API_KEY=...   # required
   - MCP_TOOLBOX_URL=...  # required, e.g. http://127.0.0.1:5000
   - PORT=3000            # optional

2) Install dependencies
   - npm i

3) Run
   - npm run dev
   - or: npm start

Endpoints
- GET /tools
  - Response: { tools: Tool[] }

- POST /tool
  - Body: { name: string, args: object }
  - Response: { result: any }

- POST /nl
  - Body: { query: string }
  - Flow: list tools → Gemini plans tool+args (JSON) → call MCP tool → Gemini summary
  - Response: { plan: {tool,args,rationale}, result: any, summary: string }

Notes
- Security: All tools are allowed by default. If you need an allowlist, you can add it later.
- Error handling: The server returns JSON errors with proper status codes.
- Gemini output parsing: The planner prompts Gemini to return strict JSON; code fences are stripped if present.
