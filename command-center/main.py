import os
import json
import time
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional, Any

import httpx
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date

from database import get_db, init_db, TokenUsage, ActivityLog

OPENCLAW_URL = os.getenv("OPENCLAW_URL", "http://127.0.0.1:18789")
OPENCLAW_TOKEN = os.getenv("OPENCLAW_TOKEN", "")
CC_PORT = int(os.getenv("CC_PORT", "8090"))
CC_PASSWORD = os.getenv("CC_PASSWORD", "admin123")
USD_BRL_RATE = float(os.getenv("USD_BRL_RATE", "5.70"))

MODEL_PRICES = {
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-opus-4-6": {"input": 15.00, "output": 75.00},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
}

OPENCLAW_CONFIG_PATH = Path.home() / ".openclaw" / "openclaw.json"

app = FastAPI(title="OpenClaw Command Center")
init_db()


def openclaw_headers():
    headers = {"Content-Type": "application/json"}
    if OPENCLAW_TOKEN:
        headers["Authorization"] = f"Bearer {OPENCLAW_TOKEN}"
    return headers


async def proxy_get(path: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{OPENCLAW_URL}{path}", headers=openclaw_headers())
        resp.raise_for_status()
        return resp.json()


async def proxy_post(path: str, body: Any) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{OPENCLAW_URL}{path}", json=body, headers=openclaw_headers())
        resp.raise_for_status()
        return resp.json()


# ── Proxy endpoints ──────────────────────────────────────────────────────────

@app.get("/api/openclaw/status")
async def openclaw_status():
    try:
        data = await proxy_get("/")
        return {"online": True, "data": data}
    except Exception as e:
        return {"online": False, "error": str(e)}


@app.get("/api/openclaw/sessions")
async def openclaw_sessions():
    try:
        return await proxy_get("/sessions")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/openclaw/message")
async def openclaw_message(request: Request):
    body = await request.json()
    try:
        return await proxy_post("/v1/chat/completions", body)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/openclaw/skills")
async def openclaw_skills():
    try:
        return await proxy_get("/skills")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/openclaw/tools")
async def openclaw_tools(request: Request):
    body = await request.json()
    try:
        return await proxy_post("/tools/invoke", body)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
async def dashboard(db: Session = Depends(get_db)):
    today = date.today()

    gateway_online = False
    active_agents = 0
    try:
        sessions_data = await proxy_get("/sessions")
        if isinstance(sessions_data, list):
            active_agents = len([s for s in sessions_data if s.get("status") == "active"])
        elif isinstance(sessions_data, dict):
            active_agents = sessions_data.get("active_count", 0)
        gateway_online = True
    except Exception:
        pass

    messages_today = (
        db.query(func.count(ActivityLog.id))
        .filter(
            func.date(ActivityLog.timestamp) == today,
            ActivityLog.event_type == "message_received",
        )
        .scalar()
        or 0
    )

    cost_today_usd = (
        db.query(func.sum(TokenUsage.cost_usd))
        .filter(func.date(TokenUsage.timestamp) == today)
        .scalar()
        or 0.0
    )
    cost_today_brl = cost_today_usd * USD_BRL_RATE

    activities = (
        db.query(ActivityLog)
        .order_by(ActivityLog.timestamp.desc())
        .limit(10)
        .all()
    )

    activity_list = []
    for a in activities:
        activity_list.append(
            {
                "id": a.id,
                "timestamp": a.timestamp.isoformat() if a.timestamp else None,
                "agent_id": a.agent_id,
                "channel": a.channel,
                "event_type": a.event_type,
                "summary": a.summary,
            }
        )

    return {
        "gateway_online": gateway_online,
        "active_agents": active_agents,
        "messages_today": messages_today,
        "cost_today_brl": round(cost_today_brl, 4),
        "activities": activity_list,
    }


# ── Costs ─────────────────────────────────────────────────────────────────────

@app.get("/api/costs")
async def costs(
    period: str = "month",
    db: Session = Depends(get_db),
):
    today = date.today()
    if period == "today":
        start = datetime.combine(today, datetime.min.time())
    elif period == "week":
        start = datetime.combine(today - timedelta(days=7), datetime.min.time())
    else:
        start = datetime.combine(today.replace(day=1), datetime.min.time())

    rows = (
        db.query(TokenUsage)
        .filter(TokenUsage.timestamp >= start)
        .all()
    )

    by_model: dict = {}
    by_channel: dict = {}
    by_agent: dict = {}
    daily: dict = {}

    for r in rows:
        cost_brl = (r.cost_usd or 0.0) * USD_BRL_RATE
        model = r.model or "unknown"
        channel = r.channel or "unknown"
        agent = r.agent_id or "unknown"
        day = r.timestamp.strftime("%Y-%m-%d") if r.timestamp else "unknown"

        by_model[model] = by_model.get(model, 0.0) + cost_brl
        by_channel[channel] = by_channel.get(channel, 0.0) + cost_brl
        by_agent[agent] = by_agent.get(agent, 0.0) + cost_brl
        daily[day] = daily.get(day, 0.0) + cost_brl

    total = sum(by_model.values())

    days_elapsed = max((today - today.replace(day=1)).days + 1, 1)
    days_in_month = 30
    projection = (total / days_elapsed) * days_in_month if days_elapsed else 0

    most_used = max(by_model, key=lambda k: by_model[k]) if by_model else None

    return {
        "total_brl": round(total, 4),
        "projection_brl": round(projection, 4),
        "most_used_model": most_used,
        "by_model": {k: round(v, 4) for k, v in by_model.items()},
        "by_channel": {k: round(v, 4) for k, v in by_channel.items()},
        "by_agent": {k: round(v, 4) for k, v in by_agent.items()},
        "daily": {k: round(v, 4) for k, v in sorted(daily.items())},
    }


@app.get("/api/costs/estimate")
async def costs_estimate(model: str, input_tokens: int = 0, output_tokens: int = 0):
    prices = MODEL_PRICES.get(model)
    if not prices:
        raise HTTPException(status_code=404, detail=f"Model '{model}' not found")
    cost_usd = (input_tokens / 1_000_000) * prices["input"] + (output_tokens / 1_000_000) * prices["output"]
    cost_brl = cost_usd * USD_BRL_RATE
    return {
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": round(cost_usd, 6),
        "cost_brl": round(cost_brl, 6),
        "usd_brl_rate": USD_BRL_RATE,
    }


# ── Activity ──────────────────────────────────────────────────────────────────

@app.get("/api/activity")
async def get_activity(
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
):
    total = db.query(func.count(ActivityLog.id)).scalar() or 0
    offset = (page - 1) * per_page
    rows = (
        db.query(ActivityLog)
        .order_by(ActivityLog.timestamp.desc())
        .offset(offset)
        .limit(per_page)
        .all()
    )
    items = [
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "agent_id": r.agent_id,
            "channel": r.channel,
            "event_type": r.event_type,
            "summary": r.summary,
        }
        for r in rows
    ]
    return {"total": total, "page": page, "per_page": per_page, "items": items}


@app.post("/api/activity")
async def post_activity(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    log = ActivityLog(
        timestamp=datetime.utcnow(),
        agent_id=body.get("agent_id"),
        channel=body.get("channel"),
        event_type=body.get("event_type"),
        summary=body.get("summary"),
        raw_json=json.dumps(body.get("raw")),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return {"id": log.id}


# ── Config ────────────────────────────────────────────────────────────────────

def _load_config() -> dict:
    if OPENCLAW_CONFIG_PATH.exists():
        with open(OPENCLAW_CONFIG_PATH, "r") as f:
            return json.load(f)
    return {}


def _mask_tokens(obj: Any) -> Any:
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            if any(word in k.lower() for word in ("token", "secret", "password", "key")):
                result[k] = "***masked***"
            else:
                result[k] = _mask_tokens(v)
        return result
    if isinstance(obj, list):
        return [_mask_tokens(i) for i in obj]
    return obj


@app.get("/api/config")
async def get_config():
    cfg = _load_config()
    return _mask_tokens(cfg)


@app.patch("/api/config")
async def patch_config(request: Request):
    patch = await request.json()
    cfg = _load_config()
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(cfg.get(key), dict):
            cfg[key].update(value)
        else:
            cfg[key] = value
    with open(OPENCLAW_CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    return {"ok": True}


# ── Model prices ──────────────────────────────────────────────────────────────

@app.get("/api/models")
async def get_models():
    return {"models": MODEL_PRICES, "usd_brl_rate": USD_BRL_RATE}


@app.patch("/api/models")
async def patch_models(request: Request):
    global MODEL_PRICES, USD_BRL_RATE
    body = await request.json()
    if "models" in body:
        MODEL_PRICES.update(body["models"])
    if "usd_brl_rate" in body:
        USD_BRL_RATE = float(body["usd_brl_rate"])
    return {"ok": True}


# ── Static files ──────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/dashboard.html")


@app.get("/{page}.html")
async def serve_page(page: str):
    path = Path(f"static/{page}.html")
    if path.exists():
        return FileResponse(str(path))
    raise HTTPException(status_code=404, detail="Page not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=CC_PORT, reload=True)
