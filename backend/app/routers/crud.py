"""
CRUD for sources, agents, qa_sessions, dashboards, dashboard_charts, alerts.
Compatible with frontend expectations (camelCase field names where needed).
"""
import uuid
import os
import math
from pathlib import Path
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, Any

from app.database import get_db
from app.models import User, Source, Agent, QASession, Dashboard, DashboardChart, Alert, AlertExecution, LlmConfig
from app.auth import require_user
from app.config import get_settings

router = APIRouter(tags=["crud"])

def _safe_float(value: float | int | None) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _sanitize_for_json(obj: Any) -> Any:
    """Recursively make values JSON-serializable (NaN/inf, numpy, date, datetime, Decimal)."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, float):
        if math.isnan(obj) or not math.isfinite(obj):
            return None
        return obj
    if hasattr(obj, "item"):  # numpy scalar
        try:
            return _sanitize_for_json(obj.item())
        except (ValueError, AttributeError):
            return None
    try:
        from decimal import Decimal
        if isinstance(obj, Decimal):
            try:
                if getattr(obj, "is_finite", lambda: True)() and not getattr(obj, "is_nan", lambda: False)():
                    return float(obj)
            except (ValueError, OverflowError, TypeError):
                pass
            return str(obj)
    except ImportError:
        pass
    return obj


def _build_sample_profile(df) -> dict:
    sample_rows = len(df)
    profile = {
        "sample_rows": sample_rows,
        "columns": {},
    }
    if sample_rows == 0:
        return profile
    for col in df.columns:
        series = df[col]
        col_profile = {
            "type": str(series.dtype),
            "missing": int(series.isna().sum()),
        }
        if series.dtype.kind in ("i", "u", "f"):
            numeric = series.dropna()
            if not numeric.empty:
                col_profile["numeric"] = {
                    "min": _safe_float(numeric.min()),
                    "max": _safe_float(numeric.max()),
                    "mean": _safe_float(numeric.mean()),
                    "median": _safe_float(numeric.median()),
                }
        else:
            counts = series.dropna().astype(str).value_counts().head(3)
            if not counts.empty:
                col_profile["top_values"] = counts.to_dict()
        profile["columns"][str(col)] = col_profile
    return profile


# --- Sources ---
@router.get("/sources")
async def list_sources(agent_id: Optional[str] = None, is_active: Optional[bool] = None, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    q = select(Source).where(Source.user_id == user.id).order_by(Source.created_at.desc())
    if agent_id:
        q = q.where(Source.agent_id == agent_id)
    if is_active is not None:
        q = q.where(Source.is_active == is_active)
    r = await db.execute(q)
    rows = r.scalars().all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "type": s.type,
            "ownerId": s.user_id,
            "agent_id": s.agent_id,
            "is_active": s.is_active,
            "createdAt": s.created_at.isoformat() if s.created_at else None,
            "metaJSON": _sanitize_for_json(s.metadata_) if s.metadata_ else {},
            "langflowPath": s.langflow_path,
            "langflowName": s.langflow_name,
        }
        for s in rows
    ]


class SourceCreate(BaseModel):
    name: str
    type: str  # bigquery | google_sheets | sql_database
    metadata: dict = {}
    agent_id: Optional[str] = None


@router.post("/sources")
async def create_source(
    body: SourceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Create a non-file source (BigQuery, Google Sheets, SQL). Credentials stored locally in metadata."""
    valid_types = ("bigquery", "google_sheets", "sql_database", "firebase", "mongodb", "snowflake", "notion", "excel_online", "s3", "rest_api")
    if body.type not in valid_types:
        raise HTTPException(400, f"type must be one of: {', '.join(valid_types)}")
    source_id = str(uuid.uuid4())
    source = Source(
        id=source_id,
        user_id=user.id,
        organization_id=user.organization_id or str(uuid.uuid4()),
        agent_id=body.agent_id,
        name=body.name,
        type=body.type,
        metadata_=body.metadata,
    )
    db.add(source)
    await db.commit()
    return {
        "id": source.id,
        "name": source.name,
        "type": source.type,
        "ownerId": source.user_id,
        "createdAt": source.created_at.isoformat(),
        "metaJSON": _sanitize_for_json(source.metadata_) if source.metadata_ else {},
        "langflowPath": None,
        "langflowName": None,
    }


@router.post("/sources/upload")
async def upload_source(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    settings = get_settings()
    Path(settings.data_files_dir).mkdir(parents=True, exist_ok=True)
    ext = (file.filename or "").split(".")[-1].lower()
    allowed_extensions = ("csv", "xlsx", "xls", "db", "sqlite", "sqlite3", "parquet", "json", "jsonl")
    if ext not in allowed_extensions:
        raise HTTPException(400, f"Only {', '.join(allowed_extensions)} files are allowed")
    path = f"{user.id}/{uuid.uuid4().hex}.{ext}"
    full = Path(settings.data_files_dir) / path
    full.parent.mkdir(parents=True, exist_ok=True)
    with open(full, "wb") as f:
        f.write(await file.read())
    meta: dict = {"file_path": path, "columns": [], "preview_rows": [], "row_count": 0, "sample_profile": {}, "sample_row_count": 0}
    source_type = "csv"
    if ext in ("db", "sqlite", "sqlite3"):
        # SQLite file: introspect tables
        from app.scripts.ask_sqlite import _introspect_sqlite_sync
        table_infos = _introspect_sqlite_sync(str(full))
        tables = [ti["table"] for ti in table_infos]
        meta = {
            "file_path": path,
            "tables": tables,
            "table_infos": _sanitize_for_json(table_infos),
        }
        source_type = "sqlite"
    elif ext == "csv":
        import pandas as pd
        df = pd.read_csv(full, nrows=1000)
        meta["columns"] = list(df.columns)
        meta["preview_rows"] = _sanitize_for_json(df.head(5).to_dict(orient="records"))
        meta["row_count"] = len(df)
        meta["sample_row_count"] = len(df)
        meta["sample_profile"] = _build_sample_profile(df)
    elif ext == "parquet":
        import pandas as pd
        df = pd.read_parquet(full)
        df = df.head(1000)
        meta["columns"] = list(df.columns)
        meta["preview_rows"] = _sanitize_for_json(df.head(5).to_dict(orient="records"))
        meta["row_count"] = len(df)
        meta["sample_row_count"] = len(df)
        meta["sample_profile"] = _build_sample_profile(df)
        source_type = "parquet"
    elif ext == "jsonl":
        import pandas as pd
        df = pd.read_json(full, lines=True, nrows=1000)
        meta["columns"] = list(df.columns)
        meta["preview_rows"] = _sanitize_for_json(df.head(5).to_dict(orient="records"))
        meta["row_count"] = len(df)
        meta["sample_row_count"] = len(df)
        meta["sample_profile"] = _build_sample_profile(df)
        source_type = "json"
    elif ext == "json":
        import pandas as pd
        import json as json_mod
        raw_data = json_mod.loads(full.read_text())
        if isinstance(raw_data, list):
            df = pd.json_normalize(raw_data)
        elif isinstance(raw_data, dict):
            # Try common data paths
            for data_key in ("data", "results", "items", "records"):
                if data_key in raw_data and isinstance(raw_data[data_key], list):
                    df = pd.json_normalize(raw_data[data_key])
                    break
            else:
                df = pd.json_normalize([raw_data])
        else:
            df = pd.DataFrame([{"value": raw_data}])
        df = df.head(1000)
        meta["columns"] = list(df.columns)
        meta["preview_rows"] = _sanitize_for_json(df.head(5).to_dict(orient="records"))
        meta["row_count"] = len(df)
        meta["sample_row_count"] = len(df)
        meta["sample_profile"] = _build_sample_profile(df)
        source_type = "json"
    else:
        import pandas as pd
        df = pd.read_excel(full, nrows=1000)
        meta["columns"] = list(df.columns)
        meta["preview_rows"] = _sanitize_for_json(df.head(5).to_dict(orient="records"))
        meta["row_count"] = len(df)
        meta["sample_row_count"] = len(df)
        meta["sample_profile"] = _build_sample_profile(df)
        source_type = "xlsx"
    meta = _sanitize_for_json(meta) or meta
    source_id = str(uuid.uuid4())
    source = Source(
        id=source_id,
        user_id=user.id,
        organization_id=user.organization_id or str(uuid.uuid4()),
        agent_id=None,
        name=file.filename or "file",
        type=source_type,
        metadata_=meta,
    )
    db.add(source)
    await db.commit()
    return {
        "id": source.id,
        "name": source.name,
        "type": source.type,
        "ownerId": source.user_id,
        "createdAt": source.created_at.isoformat(),
        "metaJSON": _sanitize_for_json(source.metadata_) if source.metadata_ else {},
        "langflowPath": None,
        "langflowName": None,
    }


@router.patch("/sources/{source_id}")
async def update_source(source_id: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Source not found")
    if "agent_id" in body:
        s.agent_id = body["agent_id"]
    if "is_active" in body:
        s.is_active = bool(body["is_active"])
    await db.commit()
    return {"id": s.id, "agent_id": s.agent_id, "is_active": s.is_active}


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Source).where(Source.id == source_id, Source.user_id == user.id))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Source not found")
    meta = s.metadata_ or {}
    fp = meta.get("file_path")
    if fp:
        full = Path(get_settings().data_files_dir) / fp
        if full.exists():
            full.unlink()
    await db.delete(s)
    await db.commit()
    return {"ok": True}


# --- Agents ---
@router.get("/agents")
async def list_agents(db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Agent).where(Agent.user_id == user.id).order_by(Agent.updated_at.desc()))
    agents = list(r.scalars().all())
    out = []
    for a in agents:
        if a.source_ids:
            q = select(Source.id).where(
                Source.user_id == user.id,
                or_(Source.id.in_(a.source_ids), Source.agent_id == a.id),
            )
        else:
            q = select(Source.id).where(Source.user_id == user.id, Source.agent_id == a.id)
        r2 = await db.execute(q)
        count = len(list(r2.scalars().all()))
        out.append({
            "id": a.id,
            "name": a.name,
            "description": a.description,
            "source_ids": a.source_ids or [],
            "source_relationships": a.source_relationships or [],
            "suggested_questions": a.suggested_questions or [],
            "llm_config_id": getattr(a, "llm_config_id", None),
            "created_at": a.created_at.isoformat(),
            "updated_at": a.updated_at.isoformat(),
            "source_count": count,
        })
    return out


class AgentCreate(BaseModel):
    name: str
    source_ids: list[str] = []
    source_relationships: list[dict] = []
    description: str = ""
    suggested_questions: list[str] = []
    llm_config_id: str | None = None


@router.post("/agents")
async def create_agent(body: AgentCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    agent_id = str(uuid.uuid4())
    llm_config_id = body.llm_config_id
    if not llm_config_id:
        # Use default LLM config for new workspaces
        r_def = await db.execute(
            select(LlmConfig.id).where(LlmConfig.user_id == user.id, LlmConfig.is_default == True).limit(1)
        )
        row = r_def.scalar_one_or_none()
        if row:
            llm_config_id = row
    a = Agent(
        id=agent_id,
        user_id=user.id,
        organization_id=user.organization_id or str(uuid.uuid4()),
        name=body.name,
        description=body.description,
        source_ids=body.source_ids,
        source_relationships=body.source_relationships,
        suggested_questions=body.suggested_questions,
        llm_config_id=llm_config_id,
    )
    db.add(a)
    await db.commit()
    return {"id": a.id, "name": a.name, "description": a.description, "source_ids": a.source_ids, "source_relationships": a.source_relationships or [], "suggested_questions": a.suggested_questions, "llm_config_id": a.llm_config_id, "sql_mode": getattr(a, "sql_mode", False), "created_at": a.created_at.isoformat(), "updated_at": a.updated_at.isoformat()}


@router.patch("/agents/{agent_id}")
async def update_agent(agent_id: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.user_id == user.id))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Agent not found")
    if "name" in body:
        a.name = body["name"]
    if "description" in body:
        a.description = body["description"]
    if "source_ids" in body:
        a.source_ids = body["source_ids"]
    if "source_relationships" in body:
        a.source_relationships = body["source_relationships"]
    if "suggested_questions" in body:
        a.suggested_questions = body["suggested_questions"]
    if "llm_config_id" in body:
        a.llm_config_id = body["llm_config_id"]
    if "sql_mode" in body:
        a.sql_mode = bool(body["sql_mode"])
    await db.commit()
    return {"id": a.id, "name": a.name, "description": a.description, "source_ids": a.source_ids, "source_relationships": a.source_relationships or [], "suggested_questions": a.suggested_questions, "llm_config_id": getattr(a, "llm_config_id", None), "sql_mode": getattr(a, "sql_mode", False)}


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.user_id == user.id))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Agent not found")
    return {"id": a.id, "name": a.name, "description": a.description, "source_ids": a.source_ids or [], "source_relationships": a.source_relationships or [], "suggested_questions": a.suggested_questions or [], "llm_config_id": getattr(a, "llm_config_id", None), "sql_mode": getattr(a, "sql_mode", False)}


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Agent).where(Agent.id == agent_id, Agent.user_id == user.id))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Agent not found")
    await db.delete(a)
    await db.commit()
    return {"ok": True}


# --- QA Sessions ---
@router.get("/qa_sessions")
async def list_qa_sessions(agent_id: Optional[str] = None, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    q = select(QASession).where(QASession.user_id == user.id, QASession.deleted_at.is_(None)).order_by(QASession.created_at.desc())
    if agent_id:
        q = q.where(QASession.agent_id == agent_id)
    r = await db.execute(q)
    sessions = list(r.scalars().all())
    return [
        {
            "id": s.id,
            "question": s.question,
            "answer": s.answer,
            "answerText": s.answer,
            "table_data": s.table_data,
            "imageUrl": (s.table_data or {}).get("image_url"),
            "latency": s.latency,
            "follow_up_questions": s.follow_up_questions or [],
            "conversation_history": s.conversation_history or [],
            "agent_id": s.agent_id,
            "source_id": s.source_id,
            "created_at": s.created_at.isoformat(),
        }
        for s in sessions
    ]


@router.delete("/qa_sessions/{session_id}")
async def soft_delete_qa_session(session_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(QASession).where(QASession.id == session_id, QASession.user_id == user.id))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Session not found")
    s.deleted_at = datetime.utcnow()
    await db.commit()
    return {"ok": True}


@router.patch("/qa_sessions/{session_id}")
async def update_qa_session(session_id: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(QASession).where(QASession.id == session_id, QASession.user_id == user.id))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Session not found")
    if "conversation_history" in body:
        s.conversation_history = body["conversation_history"]
    await db.commit()
    return {"ok": True}


@router.patch("/qa_sessions/{session_id}/feedback")
async def update_qa_feedback(session_id: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(QASession).where(QASession.id == session_id, QASession.user_id == user.id))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Session not found")
    s.feedback = body.get("feedback")
    await db.commit()
    return {"ok": True}


# --- Dashboards ---
@router.get("/dashboards")
async def list_dashboards(db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    from sqlalchemy import func
    r = await db.execute(select(Dashboard).where(Dashboard.user_id == user.id).order_by(Dashboard.updated_at.desc()))
    dashboards = list(r.scalars().all())
    out = []
    for d in dashboards:
        r2 = await db.execute(select(func.count(DashboardChart.id)).where(DashboardChart.dashboard_id == d.id))
        count = r2.scalar() or 0
        out.append({"id": d.id, "name": d.name, "description": d.description, "updated_at": d.updated_at.isoformat(), "chart_count": count})
    return out


@router.post("/dashboards")
async def create_dashboard(body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    dash_id = str(uuid.uuid4())
    d = Dashboard(id=dash_id, user_id=user.id, name=body.get("name", ""), description=body.get("description"))
    db.add(d)
    await db.commit()
    return {"id": d.id, "name": d.name, "description": d.description, "created_at": d.created_at.isoformat(), "updated_at": d.updated_at.isoformat()}


@router.get("/dashboards/{dashboard_id}")
async def get_dashboard(dashboard_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id, Dashboard.user_id == user.id))
    d = r.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Dashboard not found")
    r2 = await db.execute(select(DashboardChart).where(DashboardChart.dashboard_id == d.id))
    charts = list(r2.scalars().all())
    return {
        "id": d.id,
        "name": d.name,
        "description": d.description,
        "dashboard_charts": [{"id": c.id, "qa_session_id": c.qa_session_id, "image_url": c.image_url, "title": c.title, "description": c.description} for c in charts],
    }


@router.patch("/dashboards/{dashboard_id}")
async def update_dashboard(dashboard_id: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id, Dashboard.user_id == user.id))
    d = r.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Dashboard not found")
    if "name" in body:
        d.name = body["name"]
    if "description" in body:
        d.description = body["description"]
    await db.commit()
    return {"id": d.id, "name": d.name, "description": d.description}


@router.delete("/dashboards/{dashboard_id}")
async def delete_dashboard(dashboard_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id, Dashboard.user_id == user.id))
    d = r.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Dashboard not found")
    r2 = await db.execute(select(DashboardChart).where(DashboardChart.dashboard_id == dashboard_id))
    for c in r2.scalars().all():
        await db.delete(c)
    await db.delete(d)
    await db.commit()
    return {"ok": True}


@router.post("/dashboards/{dashboard_id}/charts")
async def add_chart_to_dashboard(dashboard_id: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id, Dashboard.user_id == user.id))
    d = r.scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Dashboard not found")
    qa_session_id = body.get("qaSessionId")
    image_url = body.get("imageUrl")
    if not image_url:
        rq = await db.execute(select(QASession).where(QASession.id == qa_session_id))
        qa = rq.scalar_one_or_none()
        image_url = (qa.table_data or {}).get("image_url") if qa else None
    if not image_url:
        raise HTTPException(400, "Session has no image to add to dashboard")
    chart_id = str(uuid.uuid4())
    c = DashboardChart(id=chart_id, dashboard_id=dashboard_id, qa_session_id=qa_session_id or "", image_url=image_url, title=body.get("title"), description=body.get("description"))
    db.add(c)
    await db.commit()
    return {"id": c.id, "dashboard_id": c.dashboard_id, "qa_session_id": c.qa_session_id, "image_url": c.image_url, "title": c.title, "description": c.description}


@router.delete("/dashboard_charts/{chart_id}")
async def remove_chart_from_dashboard(chart_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(DashboardChart).where(DashboardChart.id == chart_id))
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Chart not found")
    rd = await db.execute(select(Dashboard).where(Dashboard.id == c.dashboard_id, Dashboard.user_id == user.id))
    if not rd.scalar_one_or_none():
        raise HTTPException(403, "Not authorized")
    await db.delete(c)
    await db.commit()
    return {"ok": True}


@router.patch("/dashboard_charts/{chart_id}")
async def update_dashboard_chart(chart_id: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(DashboardChart).where(DashboardChart.id == chart_id))
    c = r.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Chart not found")
    rd = await db.execute(select(Dashboard).where(Dashboard.id == c.dashboard_id, Dashboard.user_id == user.id))
    if not rd.scalar_one_or_none():
        raise HTTPException(403, "Not authorized")
    if "title" in body:
        c.title = body["title"]
    if "description" in body:
        c.description = body["description"]
    await db.commit()
    return {"id": c.id, "title": c.title, "description": c.description}


# --- Alerts ---
def _serialize_alert(a: Alert) -> dict:
    return {
        "id": a.id,
        "agent_id": a.agent_id,
        "name": a.name,
        "type": getattr(a, "type", "alert") or "alert",
        "question": a.question,
        "email": a.email,
        "frequency": a.frequency,
        "execution_time": a.execution_time,
        "day_of_week": a.day_of_week,
        "day_of_month": a.day_of_month,
        "is_active": getattr(a, "is_active", True),
        "next_run": a.next_run.isoformat() if a.next_run else None,
        "last_run": a.last_run.isoformat() if getattr(a, "last_run", None) else None,
        "last_status": getattr(a, "last_status", None),
        "created_at": a.created_at.isoformat(),
    }


@router.get("/alerts")
async def list_alerts(agent_id: Optional[str] = None, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    q = select(Alert).where(Alert.user_id == user.id)
    if agent_id:
        q = q.where(Alert.agent_id == agent_id)
    q = q.order_by(Alert.created_at.desc())
    r = await db.execute(q)
    return [_serialize_alert(a) for a in r.scalars().all()]


@router.post("/alerts")
async def create_alert(body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    from app.services.alert_scheduler import _compute_next_run

    alert_id = str(uuid.uuid4())
    a = Alert(
        id=alert_id,
        user_id=user.id,
        agent_id=body["agentId"],
        name=body.get("name", ""),
        type=body.get("type", "alert"),
        question=body["question"],
        email=body["email"],
        frequency=body["frequency"],
        execution_time=body.get("executionTime", "09:00"),
        day_of_week=body.get("dayOfWeek"),
        day_of_month=body.get("dayOfMonth"),
        is_active=True,
    )
    a.next_run = _compute_next_run(a)
    db.add(a)
    await db.commit()
    return _serialize_alert(a)


@router.patch("/alerts/{alert_id}")
async def update_alert(alert_id: str, body: dict, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    from app.services.alert_scheduler import _compute_next_run

    r = await db.execute(select(Alert).where(Alert.id == alert_id, Alert.user_id == user.id))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Alert not found")

    recalc = False
    for field in ("name", "question", "email"):
        if field in body:
            setattr(a, field, body[field])
    if "type" in body:
        a.type = body["type"]
    if "is_active" in body:
        a.is_active = bool(body["is_active"])
    if "frequency" in body:
        a.frequency = body["frequency"]
        recalc = True
    if "executionTime" in body:
        a.execution_time = body["executionTime"]
        recalc = True
    if "dayOfWeek" in body:
        a.day_of_week = body["dayOfWeek"]
        recalc = True
    if "dayOfMonth" in body:
        a.day_of_month = body["dayOfMonth"]
        recalc = True

    if recalc:
        a.next_run = _compute_next_run(a)

    await db.commit()
    return _serialize_alert(a)


@router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    r = await db.execute(select(Alert).where(Alert.id == alert_id, Alert.user_id == user.id))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Alert not found")
    # Delete related executions
    from sqlalchemy import delete as sql_delete
    await db.execute(sql_delete(AlertExecution).where(AlertExecution.alert_id == alert_id))
    await db.delete(a)
    await db.commit()
    return {"ok": True}


@router.post("/alerts/{alert_id}/test")
async def test_alert(alert_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    """Execute an alert immediately for testing purposes."""
    r = await db.execute(select(Alert).where(Alert.id == alert_id, Alert.user_id == user.id))
    a = r.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Alert not found")

    from app.services.alert_scheduler import execute_alert_now
    result = await execute_alert_now(alert_id)
    return result


@router.get("/alerts/{alert_id}/executions")
async def list_alert_executions(alert_id: str, limit: int = 20, db: AsyncSession = Depends(get_db), user: User = Depends(require_user)):
    """List recent executions for an alert."""
    # Verify ownership
    r = await db.execute(select(Alert).where(Alert.id == alert_id, Alert.user_id == user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Alert not found")

    r = await db.execute(
        select(AlertExecution)
        .where(AlertExecution.alert_id == alert_id)
        .order_by(AlertExecution.created_at.desc())
        .limit(limit)
    )
    execs = list(r.scalars().all())
    return [
        {
            "id": e.id,
            "status": e.status,
            "answer": (e.answer[:500] + "...") if e.answer and len(e.answer) > 500 else e.answer,
            "error_message": e.error_message,
            "email_sent": e.email_sent,
            "webhooks_fired": e.webhooks_fired,
            "duration_ms": e.duration_ms,
            "created_at": e.created_at.isoformat(),
        }
        for e in execs
    ]
