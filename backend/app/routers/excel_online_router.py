"""
Excel Online (OneDrive/SharePoint) discovery and source metadata refresh.
- List Excel files from OneDrive
- List sheets in a file
- Refresh source metadata (columns + preview)
Note: OAuth2 flow must be handled by the frontend (popup).
The frontend sends the access_token after completing the flow.
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_user
from app.models import User, Source
from app.database import get_db
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.crud import _sanitize_for_json

router = APIRouter(prefix="/excel-online", tags=["excel-online"])


@router.post("/files")
async def list_files(
    body: dict,
    user: User = Depends(require_user),
):
    """List Excel files from OneDrive. Body: { "accessToken": "..." }."""
    access_token = body.get("accessToken")
    if not access_token:
        raise HTTPException(400, "accessToken is required")

    from app.scripts.ask_excel_online import _list_excel_files_sync

    loop = asyncio.get_event_loop()
    try:
        files = await loop.run_in_executor(
            None, lambda: _list_excel_files_sync(access_token)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"files": files}


@router.post("/sheets")
async def list_sheets(
    body: dict,
    user: User = Depends(require_user),
):
    """List worksheets in an Excel file. Body: { "accessToken", "driveId", "itemId" }."""
    access_token = body.get("accessToken")
    drive_id = body.get("driveId")
    item_id = body.get("itemId")
    if not access_token or not drive_id or not item_id:
        raise HTTPException(400, "accessToken, driveId, and itemId are required")

    from app.scripts.ask_excel_online import _list_sheets_sync

    loop = asyncio.get_event_loop()
    try:
        sheets = await loop.run_in_executor(
            None, lambda: _list_sheets_sync(access_token, drive_id, item_id)
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    return {"sheets": sheets}


@router.post("/sources/{source_id}/refresh-metadata")
async def refresh_source_metadata(
    source_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    """Fetch sheet data and update source metadata."""
    r = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user.id)
    )
    source = r.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Source not found")
    if source.type != "excel_online":
        raise HTTPException(400, "Source is not Excel Online")

    meta = dict(source.metadata_ or {})
    access_token = meta.get("accessToken")
    drive_id = meta.get("driveId")
    item_id = meta.get("itemId")
    sheet_name = meta.get("sheetName", "Sheet1")

    if not access_token or not drive_id or not item_id:
        raise HTTPException(400, "Source missing accessToken, driveId, or itemId")

    from app.scripts.ask_excel_online import _fetch_sheet_data_sync

    loop = asyncio.get_event_loop()
    try:
        sheet_data = await loop.run_in_executor(
            None,
            lambda: _fetch_sheet_data_sync(access_token, drive_id, item_id, sheet_name),
        )
    except Exception as e:
        raise HTTPException(400, str(e))

    meta["columns"] = sheet_data.get("columns", [])
    meta["preview"] = sheet_data.get("rows", [])[:5]
    meta["rowCount"] = sheet_data.get("rowCount", 0)
    source.metadata_ = _sanitize_for_json(meta)
    await db.commit()
    await db.refresh(source)
    return {"metaJSON": source.metadata_}
