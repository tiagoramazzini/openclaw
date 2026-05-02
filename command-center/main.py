import os
import json
import asyncio
import csv
import io
from contextlib import asynccontextmanager
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional, Any

import httpx
from fastapi import FastAPI, Depends, HTTPException, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import (
    get_db, init_db,
    TokenUsage, ActivityLog,
    ChatSession, ChatMessage,
    AlertRule, AlertEvent,
    CronJob, Workspace,
)

OPENCLAW_URL = os.getenv("OPENCLAW_URL", "http://127.0.0.1:18789")
OPENCLAW_TOKEN = os.getenv("OPENCLAW_TOKEN", "")
CC_PORT = int(os.getenv("CC_PORT", "8090"))
CC_PASSWORD = os.getenv("CC_PASSWORD", "admin123")
USD_BRL_RATE = float(os.getenv("USD_BRL_RATE", "5.70"))

MODEL_PRICES: dict = {
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-opus-4-6":   {"input": 15.00, "output": 75.00},
    "gpt-4o":            {"input": 2.50, "output": 10.00},
    "gpt-4o-mini":       {"input": 0.15, "output": 0.60},
    "gemini-2.0-flash":  {"input": 0.10, "output": 0.40},
}

OPENCLAW_CONFIG_PATH = Path.home() / ".openclaw" / "openclaw.json"
SKILLS_DIR = Path.home() / ".openclaw" / "skills"

_status_cache: dict = {}
_status_cache_ts: float = 0.0
CACHE_TTL = 30.0


# ── Workspace helpers ─────────────────────────────────────────────────────────

def _get_workspace_settings(workspace_id: Optional[int], db: Session):
    if workspace_id:
        ws = db.query(Workspace).filter(Workspace.id == workspace_id).first()
        if ws:
            return ws.gateway_url, ws.gateway_token or "", ws.usd_brl_rate
    return OPENCLAW_URL, OPENCLAW_TOKEN, USD_BRL_RATE


def _ws_headers(token: str) -> dict:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def _proxy_get(url: str, token: str, path: str) -> Any:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{url}{path}", headers=_ws_headers(token))
        r.raise_for_status()
        return r.json()


async def _proxy_post(url: str, token: str, path: str, body: Any) -> Any:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(f"{url}{path}", json=body, headers=_ws_headers(token))
        r.raise_for_status()
        return r.json()


def _calc_cost(model: str, input_tokens: int, output_tokens: int, rate: float) -> float:
    prices = MODEL_PRICES.get(model, {"input": 0, "output": 0})
    usd = (input_tokens / 1_000_000) * prices["input"] + (output_tokens / 1_000_000) * prices["output"]
    return round(usd * rate, 6)


# ── Cron helpers ──────────────────────────────────────────────────────────────

def _next_run_from_expr(expr: str) -> datetime:
    now = datetime.utcnow()
    e = expr.strip().lower()
    if e == "hourly":
        return now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    if e == "daily":
        return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    if e == "weekly":
        days_ahead = 7 - now.weekday()
        return (now + timedelta(days=days_ahead)).replace(hour=0, minute=0, second=0, microsecond=0)
    if e == "monthly":
        if now.month == 12:
            return now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        return now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    parts = e.split()
    if len(parts) == 5:
        try:
            minute = int(parts[0]) if parts[0] != "*" else now.minute
            hour   = int(parts[1]) if parts[1] != "*" else now.hour
            candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate <= now:
                candidate += timedelta(days=1)
            return candidate
        except Exception:
            pass
    return now + timedelta(hours=1)


# ── Background tasks ──────────────────────────────────────────────────────────

async def _alert_checker():
    while True:
        await asyncio.sleep(60)
        try:
            db = next(get_db())
            try:
                rules = db.query(AlertRule).filter(AlertRule.active == True).all()
                today = date.today()
                month_start = datetime.combine(today.replace(day=1), datetime.min.time())

                for rule in rules:
                    triggered = False
                    ctx = {}
                    if rule.type == "cost_daily":
                        cost = db.query(func.sum(TokenUsage.cost_usd)).filter(
                            func.date(TokenUsage.timestamp) == today,
                            TokenUsage.workspace_id == rule.workspace_id,
                        ).scalar() or 0.0
                        cost_brl = cost * USD_BRL_RATE
                        if cost_brl >= rule.threshold:
                            triggered = True
                            ctx = {"cost_brl": round(cost_brl, 4), "threshold": rule.threshold}
                    elif rule.type == "cost_monthly":
                        cost = db.query(func.sum(TokenUsage.cost_usd)).filter(
                            TokenUsage.timestamp >= month_start,
                            TokenUsage.workspace_id == rule.workspace_id,
                        ).scalar() or 0.0
                        cost_brl = cost * USD_BRL_RATE
                        if cost_brl >= rule.threshold:
                            triggered = True
                            ctx = {"cost_brl": round(cost_brl, 4), "threshold": rule.threshold}
                    elif rule.type == "error_repeated":
                        hour_ago = datetime.utcnow() - timedelta(hours=1)
                        count = db.query(func.count(ActivityLog.id)).filter(
                            ActivityLog.event_type == "error",
                            ActivityLog.timestamp >= hour_ago,
                            ActivityLog.workspace_id == rule.workspace_id,
                        ).scalar() or 0
                        if count >= rule.threshold:
                            triggered = True
                            ctx = {"error_count": count, "threshold": rule.threshold}

                    if triggered:
                        recent = db.query(AlertEvent).filter(
                            AlertEvent.rule_id == rule.id,
                            AlertEvent.triggered_at >= datetime.utcnow() - timedelta(minutes=30),
                        ).first()
                        if not recent:
                            event = AlertEvent(
                                rule_id=rule.id,
                                context_json=json.dumps(ctx),
                                acknowledged=False,
                            )
                            db.add(event)
                            db.commit()
            finally:
                db.close()
        except Exception:
            pass


async def _cron_runner():
    while True:
        await asyncio.sleep(60)
        try:
            db = next(get_db())
            try:
                now = datetime.utcnow()
                jobs = db.query(CronJob).filter(
                    CronJob.active == True,
                    CronJob.next_run <= now,
                ).all()
                for job in jobs:
                    try:
                        gw_url, gw_token, rate = _get_workspace_settings(job.workspace_id, db)
                        resp = await _proxy_post(gw_url, gw_token, "/v1/chat/completions", {
                            "model": "default",
                            "messages": [{"role": "user", "content": job.prompt}],
                        })
                        job.last_status = "success"
                        log = ActivityLog(
                            agent_id=job.agent_id,
                            event_type="cron_run",
                            summary=f"[CRON] {job.name}: OK",
                            workspace_id=job.workspace_id,
                        )
                        db.add(log)
                    except Exception as ex:
                        job.last_status = f"error: {str(ex)[:80]}"
                    finally:
                        job.last_run = now
                        job.next_run = _next_run_from_expr(job.cron_expr)
                db.commit()
            finally:
                db.close()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task1 = asyncio.create_task(_alert_checker())
    task2 = asyncio.create_task(_cron_runner())
    yield
    task1.cancel()
    task2.cancel()


app = FastAPI(title="OpenClaw Command Center", lifespan=lifespan)


# ── Workspace resolution middleware ───────────────────────────────────────────

def resolve_workspace(workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    return _get_workspace_settings(workspace_id, db)


# ── Proxy endpoints ───────────────────────────────────────────────────────────

@app.get("/api/openclaw/status")
async def openclaw_status(workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    global _status_cache, _status_cache_ts
    import time
    key = str(workspace_id)
    if time.time() - _status_cache_ts < CACHE_TTL and key in _status_cache:
        return _status_cache[key]
    gw_url, gw_token, _ = _get_workspace_settings(workspace_id, db)
    try:
        data = await _proxy_get(gw_url, gw_token, "/")
        result = {"online": True, "data": data}
    except Exception as e:
        result = {"online": False, "error": str(e)}
    _status_cache[key] = result
    _status_cache_ts = time.time()
    return result


@app.get("/api/openclaw/sessions")
async def openclaw_sessions(workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    gw_url, gw_token, _ = _get_workspace_settings(workspace_id, db)
    try:
        return await _proxy_get(gw_url, gw_token, "/sessions")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/openclaw/message")
async def openclaw_message(request: Request, workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    body = await request.json()
    gw_url, gw_token, _ = _get_workspace_settings(workspace_id, db)
    try:
        return await _proxy_post(gw_url, gw_token, "/v1/chat/completions", body)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/openclaw/skills")
async def openclaw_skills(workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    gw_url, gw_token, _ = _get_workspace_settings(workspace_id, db)
    try:
        return await _proxy_get(gw_url, gw_token, "/skills")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/openclaw/tools")
async def openclaw_tools(request: Request, workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    body = await request.json()
    gw_url, gw_token, _ = _get_workspace_settings(workspace_id, db)
    try:
        return await _proxy_post(gw_url, gw_token, "/tools/invoke", body)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/api/dashboard")
async def dashboard(workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    today = date.today()
    gw_url, gw_token, rate = _get_workspace_settings(workspace_id, db)

    gateway_online = False
    active_agents = 0
    try:
        sessions_data = await _proxy_get(gw_url, gw_token, "/sessions")
        if isinstance(sessions_data, list):
            active_agents = len([s for s in sessions_data if s.get("status") == "active"])
        elif isinstance(sessions_data, dict):
            active_agents = sessions_data.get("active_count", 0)
        gateway_online = True
    except Exception:
        pass

    messages_today = db.query(func.count(ActivityLog.id)).filter(
        func.date(ActivityLog.timestamp) == today,
        ActivityLog.event_type == "message_received",
    ).scalar() or 0

    cost_today_usd = db.query(func.sum(TokenUsage.cost_usd)).filter(
        func.date(TokenUsage.timestamp) == today,
    ).scalar() or 0.0

    activities = db.query(ActivityLog).order_by(ActivityLog.timestamp.desc()).limit(10).all()
    activity_list = [
        {
            "id": a.id,
            "timestamp": a.timestamp.isoformat() if a.timestamp else None,
            "agent_id": a.agent_id,
            "channel": a.channel,
            "event_type": a.event_type,
            "summary": a.summary,
        }
        for a in activities
    ]

    unread_alerts = db.query(func.count(AlertEvent.id)).filter(AlertEvent.acknowledged == False).scalar() or 0

    return {
        "gateway_online": gateway_online,
        "active_agents": active_agents,
        "messages_today": messages_today,
        "cost_today_brl": round(cost_today_usd * rate, 4),
        "activities": activity_list,
        "unread_alerts": unread_alerts,
    }


# ── Costs ─────────────────────────────────────────────────────────────────────

@app.get("/api/costs")
async def costs(period: str = "month", workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    _, _, rate = _get_workspace_settings(workspace_id, db)
    today = date.today()
    if period == "today":
        start = datetime.combine(today, datetime.min.time())
    elif period == "week":
        start = datetime.combine(today - timedelta(days=7), datetime.min.time())
    else:
        start = datetime.combine(today.replace(day=1), datetime.min.time())

    rows = db.query(TokenUsage).filter(TokenUsage.timestamp >= start).all()
    by_model: dict = {}
    by_channel: dict = {}
    by_agent: dict = {}
    daily: dict = {}

    for r in rows:
        cost_brl = (r.cost_usd or 0.0) * rate
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
    projection = (total / days_elapsed) * 30
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
async def costs_estimate(model: str, input_tokens: int = 0, output_tokens: int = 0,
                         workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    _, _, rate = _get_workspace_settings(workspace_id, db)
    prices = MODEL_PRICES.get(model)
    if not prices:
        raise HTTPException(status_code=404, detail=f"Model '{model}' not found")
    cost_usd = (input_tokens / 1_000_000) * prices["input"] + (output_tokens / 1_000_000) * prices["output"]
    return {
        "model": model, "input_tokens": input_tokens, "output_tokens": output_tokens,
        "cost_usd": round(cost_usd, 6), "cost_brl": round(cost_usd * rate, 6), "usd_brl_rate": rate,
    }


# ── Activity ──────────────────────────────────────────────────────────────────

@app.get("/api/activity")
async def get_activity(page: int = 1, per_page: int = 20, workspace_id: Optional[int] = None,
                       db: Session = Depends(get_db)):
    total = db.query(func.count(ActivityLog.id)).scalar() or 0
    offset = (page - 1) * per_page
    rows = db.query(ActivityLog).order_by(ActivityLog.timestamp.desc()).offset(offset).limit(per_page).all()
    items = [
        {"id": r.id, "timestamp": r.timestamp.isoformat() if r.timestamp else None,
         "agent_id": r.agent_id, "channel": r.channel, "event_type": r.event_type, "summary": r.summary}
        for r in rows
    ]
    return {"total": total, "page": page, "per_page": per_page, "items": items}


@app.post("/api/activity")
async def post_activity(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    log = ActivityLog(
        agent_id=body.get("agent_id"), channel=body.get("channel"),
        event_type=body.get("event_type"), summary=body.get("summary"),
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
        return {k: "***masked***" if any(w in k.lower() for w in ("token", "secret", "password", "key")) else _mask_tokens(v)
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [_mask_tokens(i) for i in obj]
    return obj


@app.get("/api/config")
async def get_config():
    return _mask_tokens(_load_config())


@app.patch("/api/config")
async def patch_config(request: Request):
    patch = await request.json()
    cfg = _load_config()
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(cfg.get(key), dict):
            cfg[key].update(value)
        else:
            cfg[key] = value
    OPENCLAW_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OPENCLAW_CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    return {"ok": True}


# ── Models ────────────────────────────────────────────────────────────────────

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


# ── Chat ──────────────────────────────────────────────────────────────────────

@app.post("/api/chat/send")
async def chat_send(request: Request, workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    body = await request.json()
    session_id = body.get("session_id")
    model = body.get("model", "gpt-4o-mini")
    messages = body.get("messages", [])
    agent_id = body.get("agent_id", "default")

    gw_url, gw_token, rate = _get_workspace_settings(workspace_id, db)

    if not session_id:
        sess = ChatSession(workspace_id=workspace_id, agent_id=agent_id, model=model)
        db.add(sess)
        db.commit()
        db.refresh(sess)
        session_id = sess.id
    else:
        sess = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not sess:
            sess = ChatSession(id=session_id, workspace_id=workspace_id, agent_id=agent_id, model=model)
            db.add(sess)
            db.commit()

    user_msg = messages[-1] if messages else {"role": "user", "content": ""}
    user_record = ChatMessage(session_id=session_id, role="user", content=user_msg.get("content", ""))
    db.add(user_record)
    db.commit()

    try:
        resp = await _proxy_post(gw_url, gw_token, "/v1/chat/completions", {
            "model": model, "messages": messages,
        })
        choice = resp.get("choices", [{}])[0]
        assistant_content = choice.get("message", {}).get("content", "") or choice.get("text", "")
        usage = resp.get("usage", {})
        in_tok  = usage.get("prompt_tokens", 0)
        out_tok = usage.get("completion_tokens", 0)
        prices = MODEL_PRICES.get(model, {"input": 0, "output": 0})
        cost_usd = (in_tok / 1_000_000) * prices["input"] + (out_tok / 1_000_000) * prices["output"]
        cost_brl = round(cost_usd * rate, 6)

        assistant_record = ChatMessage(
            session_id=session_id, role="assistant", content=assistant_content,
            input_tokens=in_tok, output_tokens=out_tok, cost_usd=cost_usd,
        )
        db.add(assistant_record)
        usage_record = TokenUsage(
            agent_id=agent_id, model=model, input_tokens=in_tok,
            output_tokens=out_tok, cost_usd=cost_usd, channel="chat",
            session_id=str(session_id), workspace_id=workspace_id,
        )
        db.add(usage_record)
        db.commit()

        return {
            "session_id": session_id, "content": assistant_content,
            "input_tokens": in_tok, "output_tokens": out_tok,
            "cost_usd": round(cost_usd, 6), "cost_brl": cost_brl,
        }
    except Exception as e:
        return {"session_id": session_id, "content": f"[Erro: {e}]", "cost_brl": 0}


@app.get("/api/chat/sessions")
async def chat_sessions(workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    sessions = db.query(ChatSession).order_by(ChatSession.started_at.desc()).limit(50).all()
    result = []
    for s in sessions:
        msg_count = db.query(func.count(ChatMessage.id)).filter(ChatMessage.session_id == s.id).scalar() or 0
        total_cost = db.query(func.sum(ChatMessage.cost_usd)).filter(ChatMessage.session_id == s.id).scalar() or 0.0
        first_msg = db.query(ChatMessage).filter(ChatMessage.session_id == s.id, ChatMessage.role == "user").first()
        result.append({
            "id": s.id, "agent_id": s.agent_id, "model": s.model,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "message_count": msg_count, "total_cost_usd": round(total_cost, 6),
            "preview": (first_msg.content[:60] + "…") if first_msg and len(first_msg.content) > 60 else (first_msg.content if first_msg else "—"),
        })
    return result


@app.get("/api/chat/sessions/{session_id}")
async def chat_session_messages(session_id: int, db: Session = Depends(get_db)):
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.timestamp).all()
    return [
        {"id": m.id, "role": m.role, "content": m.content,
         "input_tokens": m.input_tokens, "output_tokens": m.output_tokens,
         "cost_usd": m.cost_usd, "timestamp": m.timestamp.isoformat() if m.timestamp else None}
        for m in messages
    ]


# ── Skills CRUD ───────────────────────────────────────────────────────────────

@app.get("/api/skills/list")
async def skills_list():
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    result = []
    for skill_dir in SKILLS_DIR.iterdir():
        if skill_dir.is_dir():
            md_file = skill_dir / "SKILL.md"
            size = md_file.stat().st_size if md_file.exists() else 0
            result.append({"name": skill_dir.name, "has_md": md_file.exists(), "size": size})
    return result


@app.post("/api/skills/create")
async def skills_create(request: Request):
    body = await request.json()
    name = body.get("name", "").strip().replace(" ", "_")
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    description = body.get("description", "")
    triggers = body.get("triggers", [])
    steps = body.get("steps", [])

    triggers_section = "\n".join(f"- {t}" for t in triggers) if triggers else "- (nenhum)"
    steps_section = ""
    for i, step in enumerate(steps, 1):
        stype = step.get("type", "shell")
        content = step.get("content", "")
        steps_section += f"\n### Step {i} ({stype})\n```\n{content}\n```\n"

    md_content = f"""# {name}

## Descrição
{description}

## Trigger phrases
{triggers_section}

## Comandos
{steps_section}
"""
    skill_dir = SKILLS_DIR / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(md_content)
    return {"ok": True, "name": name, "path": str(skill_dir / "SKILL.md")}


@app.delete("/api/skills/{name}")
async def skills_delete(name: str):
    import shutil
    skill_dir = SKILLS_DIR / name
    if not skill_dir.exists():
        raise HTTPException(status_code=404, detail="Skill not found")
    shutil.rmtree(skill_dir)
    return {"ok": True}


# ── Alerts ────────────────────────────────────────────────────────────────────

@app.get("/api/alerts/rules")
async def get_alert_rules(workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    rules = db.query(AlertRule).all()
    return [
        {"id": r.id, "type": r.type, "threshold": r.threshold, "unit": r.unit,
         "channel": r.channel, "active": r.active, "created_at": r.created_at.isoformat() if r.created_at else None}
        for r in rules
    ]


@app.post("/api/alerts/rules")
async def create_alert_rule(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    rule = AlertRule(
        workspace_id=body.get("workspace_id"),
        type=body.get("type", "cost_daily"),
        threshold=float(body.get("threshold", 10)),
        unit=body.get("unit"),
        channel=body.get("channel"),
        active=body.get("active", True),
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return {"id": rule.id}


@app.patch("/api/alerts/rules/{rule_id}")
async def patch_alert_rule(rule_id: int, request: Request, db: Session = Depends(get_db)):
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    body = await request.json()
    for k, v in body.items():
        if hasattr(rule, k):
            setattr(rule, k, v)
    db.commit()
    return {"ok": True}


@app.delete("/api/alerts/rules/{rule_id}")
async def delete_alert_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if rule:
        db.delete(rule)
        db.commit()
    return {"ok": True}


@app.get("/api/alerts/events")
async def get_alert_events(db: Session = Depends(get_db)):
    events = db.query(AlertEvent).order_by(AlertEvent.triggered_at.desc()).limit(50).all()
    result = []
    for e in events:
        rule = db.query(AlertRule).filter(AlertRule.id == e.rule_id).first()
        result.append({
            "id": e.id, "rule_id": e.rule_id,
            "rule_type": rule.type if rule else "unknown",
            "threshold": rule.threshold if rule else None,
            "triggered_at": e.triggered_at.isoformat() if e.triggered_at else None,
            "context": json.loads(e.context_json) if e.context_json else {},
            "acknowledged": e.acknowledged,
        })
    return result


@app.post("/api/alerts/events/{event_id}/acknowledge")
async def acknowledge_alert(event_id: int, db: Session = Depends(get_db)):
    event = db.query(AlertEvent).filter(AlertEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    event.acknowledged = True
    db.commit()
    return {"ok": True}


# ── History ───────────────────────────────────────────────────────────────────

@app.get("/api/history")
async def history(
    q: Optional[str] = None,
    agent_id: Optional[str] = None,
    channel: Optional[str] = None,
    model: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    workspace_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    _, _, rate = _get_workspace_settings(workspace_id, db)
    query = db.query(ChatSession)
    if agent_id:
        query = query.filter(ChatSession.agent_id == agent_id)
    if model:
        query = query.filter(ChatSession.model == model)
    if date_from:
        query = query.filter(ChatSession.started_at >= datetime.fromisoformat(date_from))
    if date_to:
        query = query.filter(ChatSession.started_at <= datetime.fromisoformat(date_to))

    sessions = query.order_by(ChatSession.started_at.desc()).all()

    result = []
    for s in sessions:
        msgs_query = db.query(ChatMessage).filter(ChatMessage.session_id == s.id)
        if q:
            msgs_query = msgs_query.filter(ChatMessage.content.contains(q))
        msgs = msgs_query.all()
        if q and not msgs:
            continue
        msg_count = len(msgs) or db.query(func.count(ChatMessage.id)).filter(ChatMessage.session_id == s.id).scalar() or 0
        total_in  = sum(m.input_tokens for m in msgs) if msgs else 0
        total_out = sum(m.output_tokens for m in msgs) if msgs else 0
        total_cost_usd = sum(m.cost_usd or 0.0 for m in msgs) if msgs else 0.0
        duration = None
        if s.ended_at and s.started_at:
            duration = int((s.ended_at - s.started_at).total_seconds())

        result.append({
            "id": s.id, "agent_id": s.agent_id, "model": s.model, "channel": "chat",
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "message_count": msg_count,
            "input_tokens": total_in, "output_tokens": total_out,
            "cost_brl": round(total_cost_usd * rate, 4),
            "duration_sec": duration,
        })

    total = len(result)
    offset = (page - 1) * per_page
    page_items = result[offset:offset + per_page]

    total_sessions = total
    total_messages = sum(r["message_count"] for r in result)
    total_cost = round(sum(r["cost_brl"] for r in result), 4)
    models_count: dict = {}
    for r in result:
        m = r["model"] or "unknown"
        models_count[m] = models_count.get(m, 0) + 1
    top_model = max(models_count, key=lambda k: models_count[k]) if models_count else None

    return {
        "total": total, "page": page, "per_page": per_page,
        "items": page_items,
        "kpis": {
            "total_sessions": total_sessions, "total_messages": total_messages,
            "total_cost_brl": total_cost, "top_model": top_model,
        },
    }


@app.get("/api/history/export")
async def history_export(
    q: Optional[str] = None, agent_id: Optional[str] = None,
    channel: Optional[str] = None, model: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    workspace_id: Optional[int] = None, db: Session = Depends(get_db),
):
    data = await history(q=q, agent_id=agent_id, channel=channel, model=model,
                         date_from=date_from, date_to=date_to, page=1, per_page=10000,
                         workspace_id=workspace_id, db=db)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["id","agent_id","model","channel","started_at","message_count","input_tokens","output_tokens","cost_brl","duration_sec"])
    writer.writeheader()
    for item in data["items"]:
        writer.writerow(item)
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=history.csv"})


# ── Cron ──────────────────────────────────────────────────────────────────────

@app.get("/api/cron")
async def cron_list(workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    jobs = db.query(CronJob).order_by(CronJob.created_at.desc()).all()
    return [
        {"id": j.id, "name": j.name, "agent_id": j.agent_id, "prompt": j.prompt,
         "cron_expr": j.cron_expr, "active": j.active,
         "last_run": j.last_run.isoformat() if j.last_run else None,
         "next_run": j.next_run.isoformat() if j.next_run else None,
         "last_status": j.last_status}
        for j in jobs
    ]


@app.post("/api/cron")
async def cron_create(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    cron_expr = body.get("cron_expr", "daily")
    job = CronJob(
        workspace_id=body.get("workspace_id"),
        name=body.get("name", "Task"),
        agent_id=body.get("agent_id"),
        prompt=body.get("prompt", ""),
        cron_expr=cron_expr,
        active=body.get("active", True),
        next_run=_next_run_from_expr(cron_expr),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return {"id": job.id}


@app.patch("/api/cron/{job_id}")
async def cron_patch(job_id: int, request: Request, db: Session = Depends(get_db)):
    job = db.query(CronJob).filter(CronJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    body = await request.json()
    for k, v in body.items():
        if hasattr(job, k):
            setattr(job, k, v)
    if "cron_expr" in body:
        job.next_run = _next_run_from_expr(body["cron_expr"])
    db.commit()
    return {"ok": True}


@app.delete("/api/cron/{job_id}")
async def cron_delete(job_id: int, db: Session = Depends(get_db)):
    job = db.query(CronJob).filter(CronJob.id == job_id).first()
    if job:
        db.delete(job)
        db.commit()
    return {"ok": True}


@app.post("/api/cron/{job_id}/run")
async def cron_run_now(job_id: int, workspace_id: Optional[int] = None, db: Session = Depends(get_db)):
    job = db.query(CronJob).filter(CronJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    gw_url, gw_token, _ = _get_workspace_settings(workspace_id or job.workspace_id, db)
    try:
        resp = await _proxy_post(gw_url, gw_token, "/v1/chat/completions", {
            "model": "default", "messages": [{"role": "user", "content": job.prompt}],
        })
        job.last_run = datetime.utcnow()
        job.last_status = "success (manual)"
        db.commit()
        return {"ok": True, "response": resp}
    except Exception as e:
        job.last_status = f"error: {str(e)[:80]}"
        db.commit()
        raise HTTPException(status_code=502, detail=str(e))


# ── Workspaces ────────────────────────────────────────────────────────────────

@app.get("/api/workspaces")
async def workspaces_list(db: Session = Depends(get_db)):
    wss = db.query(Workspace).all()
    result = [
        {"id": w.id, "name": w.name, "gateway_url": w.gateway_url,
         "usd_brl_rate": w.usd_brl_rate, "active": w.active,
         "created_at": w.created_at.isoformat() if w.created_at else None}
        for w in wss
    ]
    result.insert(0, {"id": None, "name": "Padrão (env)", "gateway_url": OPENCLAW_URL, "active": True})
    return result


@app.post("/api/workspaces")
async def workspaces_create(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    ws = Workspace(
        name=body.get("name", "Workspace"),
        gateway_url=body.get("gateway_url", OPENCLAW_URL),
        gateway_token=body.get("gateway_token"),
        usd_brl_rate=float(body.get("usd_brl_rate", 5.70)),
        active=True,
    )
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return {"id": ws.id}


@app.patch("/api/workspaces/{ws_id}")
async def workspaces_patch(ws_id: int, request: Request, db: Session = Depends(get_db)):
    ws = db.query(Workspace).filter(Workspace.id == ws_id).first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    body = await request.json()
    for k, v in body.items():
        if hasattr(ws, k) and k not in ("id", "created_at"):
            setattr(ws, k, v)
    db.commit()
    return {"ok": True}


@app.delete("/api/workspaces/{ws_id}")
async def workspaces_delete(ws_id: int, db: Session = Depends(get_db)):
    ws = db.query(Workspace).filter(Workspace.id == ws_id).first()
    if ws:
        db.delete(ws)
        db.commit()
    return {"ok": True}


@app.post("/api/workspaces/{ws_id}/test")
async def workspaces_test(ws_id: Optional[int], db: Session = Depends(get_db)):
    gw_url, gw_token, _ = _get_workspace_settings(ws_id if ws_id != 0 else None, db)
    try:
        await _proxy_get(gw_url, gw_token, "/")
        return {"online": True}
    except Exception as e:
        return {"online": False, "error": str(e)}


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
