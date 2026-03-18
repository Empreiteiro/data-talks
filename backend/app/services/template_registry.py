"""
Template Registry: loads and serves built-in report template definitions from JSON files.
"""
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

# In-memory cache: populated on first access
_templates_by_id: dict[str, dict[str, Any]] = {}
_loaded = False


def _load_templates() -> None:
    """Scan the templates directory and load all JSON files."""
    global _loaded
    if _loaded:
        return

    _templates_by_id.clear()

    if not _TEMPLATES_DIR.is_dir():
        logger.warning("Templates directory not found: %s", _TEMPLATES_DIR)
        _loaded = True
        return

    for json_file in sorted(_TEMPLATES_DIR.glob("*.json")):
        if json_file.name.startswith("_"):
            continue  # skip example/internal files
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                data = [data]
            for tpl in data:
                tpl_id = tpl.get("id")
                if not tpl_id:
                    logger.warning("Skipping template without id in %s", json_file.name)
                    continue
                _templates_by_id[tpl_id] = tpl
                logger.info("Loaded template: %s (%s)", tpl_id, tpl.get("name"))
        except Exception:
            logger.exception("Failed to load template file: %s", json_file.name)

    _loaded = True


def list_templates(source_type: str | None = None) -> list[dict[str, Any]]:
    """Return all templates, optionally filtered by source_type."""
    _load_templates()
    templates = list(_templates_by_id.values())
    if source_type:
        templates = [t for t in templates if t.get("source_type") == source_type]
    return templates


def get_template(template_id: str) -> dict[str, Any] | None:
    """Return a single template by id, or None."""
    _load_templates()
    return _templates_by_id.get(template_id)


def reload_templates() -> None:
    """Force reload of all template files (useful for testing or hot-reload)."""
    global _loaded
    _loaded = False
    _load_templates()
