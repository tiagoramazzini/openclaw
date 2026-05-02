# Workspace

## Overview

pnpm workspace monorepo using TypeScript + Python FastAPI Command Center.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 (api-server) + FastAPI (command-center)
- **Database**: PostgreSQL + Drizzle ORM (api-server) / SQLite + SQLAlchemy (command-center)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Command Center (OpenClaw)

Located at `command-center/`. Python FastAPI backend + vanilla HTML/CSS/JS frontend.

### Running
Workflow: `Command Center` — runs `cd command-center && python3 -m uvicorn main:app --host 0.0.0.0 --port 8000`

### Configuration (env vars)
- `OPENCLAW_URL` — OpenClaw gateway URL (default: `http://127.0.0.1:18789`)
- `OPENCLAW_TOKEN` — Gateway auth token
- `CC_PORT` — Server port (default: `8090`, workflow uses `8000`)
- `CC_PASSWORD` — Admin password (default: `admin123`)

### Structure
```
command-center/
  main.py              ← FastAPI backend + proxy
  database.py          ← SQLite (token_usage, activity_log)
  static/
    dashboard.html / agents.html / channels.html
    skills.html / costs.html / settings.html
    js/                ← Per-page JS + shared.js
    css/style.css
  requirements.txt
  docker-compose.yml
```

### Pages
- `/` → Dashboard (KPIs, activity feed, chart)
- `/agents.html` → Agentes (sessions grid)
- `/channels.html` → Canais (WhatsApp / Telegram config)
- `/skills.html` → Skills (grid + install)
- `/costs.html` → Custos (charts + estimator + table)
- `/settings.html` → Configurações (gateway, models, raw config)
