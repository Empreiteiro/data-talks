"""
Platform logs API: list LLM activity logs (pergunta, summary, etc.).
Independent of workspace; returns all platform activity.
"""
from fastapi import APIRouter, Depends, Query

from app.auth import require_user
from app.llm.logs import list_logs
from app.models import User

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("")
async def get_logs(
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(require_user),
):
    """List platform LLM activity logs. Returns most recent first."""
    return await list_logs(limit=limit)
