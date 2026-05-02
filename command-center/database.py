from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./command_center.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class TokenUsage(Base):
    __tablename__ = "token_usage"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    agent_id = Column(String, nullable=True)
    model = Column(String, nullable=True)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)
    channel = Column(String, nullable=True)
    session_id = Column(String, nullable=True)
    workspace_id = Column(Integer, nullable=True)


class ActivityLog(Base):
    __tablename__ = "activity_log"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    agent_id = Column(String, nullable=True)
    channel = Column(String, nullable=True)
    event_type = Column(String, nullable=True)
    summary = Column(Text, nullable=True)
    raw_json = Column(Text, nullable=True)
    workspace_id = Column(Integer, nullable=True)


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, nullable=True)
    agent_id = Column(String, nullable=True)
    model = Column(String, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, nullable=False)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)
    timestamp = Column(DateTime, default=datetime.utcnow)


class AlertRule(Base):
    __tablename__ = "alert_rules"
    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, nullable=True)
    type = Column(String, nullable=False)
    threshold = Column(Float, nullable=False)
    unit = Column(String, nullable=True)
    channel = Column(String, nullable=True)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AlertEvent(Base):
    __tablename__ = "alert_events"
    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, nullable=False)
    triggered_at = Column(DateTime, default=datetime.utcnow)
    context_json = Column(Text, nullable=True)
    acknowledged = Column(Boolean, default=False)


class CronJob(Base):
    __tablename__ = "cron_jobs"
    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, nullable=True)
    name = Column(String, nullable=False)
    agent_id = Column(String, nullable=True)
    prompt = Column(Text, nullable=False)
    cron_expr = Column(String, nullable=False)
    active = Column(Boolean, default=True)
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    last_status = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Workspace(Base):
    __tablename__ = "workspaces"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    gateway_url = Column(String, nullable=False)
    gateway_token = Column(String, nullable=True)
    usd_brl_rate = Column(Float, default=5.70)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _run_migrations():
    """Add new columns to existing tables without dropping them."""
    import sqlite3
    conn = sqlite3.connect("./command_center.db")
    c = conn.cursor()
    migrations = [
        "ALTER TABLE token_usage ADD COLUMN workspace_id INTEGER",
        "ALTER TABLE token_usage ADD COLUMN session_id TEXT",
        "ALTER TABLE activity_log ADD COLUMN workspace_id INTEGER",
    ]
    for sql in migrations:
        try:
            c.execute(sql)
        except Exception:
            pass
    conn.commit()
    conn.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    _run_migrations()
