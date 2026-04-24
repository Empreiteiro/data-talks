"""Pluggable object storage for Data Talks user files.

Two backends share a single `Storage` interface:

- `LocalStorage` (default): files live under `settings.data_files_dir`.
  Simple, zero-dependency, but the directory is ephemeral on most PaaS.

- `S3Storage`: S3 (or any S3-compatible endpoint — R2, MinIO, B2) is the
  source of truth. `settings.data_files_dir` becomes a lazy download cache
  so existing code that expects a filesystem path (pandas, sqlite3,
  matplotlib, FileResponse) keeps working unchanged.

Selection is automatic: if `S3_BUCKET` is set, S3 is used; otherwise local.
The abstraction is a singleton keyed from settings via `get_storage()`.

Keys are always relative POSIX-style paths (e.g. `{user_id}/{uuid}.csv`).
Call sites should never concatenate `data_files_dir` directly anymore —
use `storage.local_path(key)` to get an on-disk path and `storage.write_bytes`
/`storage.delete` for mutations.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import get_settings


logger = logging.getLogger(__name__)


class Storage(ABC):
    """Abstract file store. Keys are relative, forward-slash, never absolute."""

    @abstractmethod
    def write_bytes(self, key: str, data: bytes) -> None:
        """Persist `data` under `key`. Creates any missing parent directories."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Remove `key`. Idempotent — no-op if missing."""

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Return True if `key` has been persisted."""

    @abstractmethod
    def local_path(self, key: str) -> Path:
        """Return a local filesystem path for `key`.

        For `LocalStorage` this is the authoritative path. For `S3Storage`
        this returns a cached local copy, fetching from S3 on first access.
        Callers may read the returned path freely but must not assume they
        can mutate the file — use `write_bytes` instead.
        """

    @abstractmethod
    def ensure_ready(self) -> None:
        """Called once on application startup. Create base dirs, verify the
        backing bucket is reachable. Must not raise on transient errors —
        the application should still boot and surface storage errors per-call.
        """

    # -- Convenience ---------------------------------------------------------

    def require_local_path(self, key: str) -> Path:
        """Like `local_path`, but raises `FileNotFoundError` if the object is
        not available locally and cannot be fetched."""
        p = self.local_path(key)
        if not p.exists():
            raise FileNotFoundError(f"Storage key not found: {key}")
        return p


# ---------------------------------------------------------------------------
# Local filesystem backend
# ---------------------------------------------------------------------------

class LocalStorage(Storage):
    def __init__(self, base_dir: str) -> None:
        self.base = Path(base_dir).resolve()

    def _abs(self, key: str) -> Path:
        # Guard against absolute paths and traversal. All keys must be
        # relative and must not escape `self.base`.
        candidate = (self.base / key).resolve()
        try:
            candidate.relative_to(self.base)
        except ValueError:
            raise ValueError(f"Storage key escapes base directory: {key!r}")
        return candidate

    def write_bytes(self, key: str, data: bytes) -> None:
        dest = self._abs(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

    def delete(self, key: str) -> None:
        try:
            p = self._abs(key)
        except ValueError:
            return
        try:
            p.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            logger.exception("Failed to delete local storage key %s", key)

    def exists(self, key: str) -> bool:
        try:
            return self._abs(key).exists()
        except ValueError:
            return False

    def local_path(self, key: str) -> Path:
        return self._abs(key)

    def ensure_ready(self) -> None:
        self.base.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# S3 backend (boto3)
# ---------------------------------------------------------------------------

class S3Storage(Storage):
    """S3 source of truth with a local cache directory for filesystem-path
    consumers (pandas, sqlite3, matplotlib, FileResponse).

    Writes go through to S3 *and* the cache. Reads hit the cache first and
    fall back to downloading from S3. Deletes remove both.
    """

    def __init__(
        self,
        *,
        bucket: str,
        prefix: str,
        cache_dir: str,
        client: Any,
    ) -> None:
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.cache = Path(cache_dir).resolve()
        self.client = client

    # -- key helpers ---------------------------------------------------------

    def _s3_key(self, key: str) -> str:
        key = key.lstrip("/")
        if not key:
            raise ValueError("Storage key must not be empty")
        if self.prefix:
            return f"{self.prefix}/{key}"
        return key

    def _cache_path(self, key: str) -> Path:
        candidate = (self.cache / key).resolve()
        try:
            candidate.relative_to(self.cache)
        except ValueError:
            raise ValueError(f"Storage key escapes cache directory: {key!r}")
        return candidate

    # -- Storage API ---------------------------------------------------------

    def write_bytes(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self._s3_key(key), Body=data)
        # Mirror into the local cache so subsequent local_path calls are fast.
        cache_path = self._cache_path(key)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(data)

    def delete(self, key: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=self._s3_key(key))
        except Exception:  # noqa: BLE001
            logger.exception("Failed to delete S3 key %s", key)
        try:
            p = self._cache_path(key)
            if p.exists():
                p.unlink()
        except (ValueError, OSError):
            logger.debug("Cache cleanup skipped for %s", key, exc_info=True)

    def exists(self, key: str) -> bool:
        # Cache hit is cheap and authoritative for presence.
        try:
            if self._cache_path(key).exists():
                return True
        except ValueError:
            return False
        try:
            self.client.head_object(Bucket=self.bucket, Key=self._s3_key(key))
            return True
        except Exception:  # noqa: BLE001
            return False

    def local_path(self, key: str) -> Path:
        p = self._cache_path(key)
        if p.exists():
            return p
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.client.download_file(self.bucket, self._s3_key(key), str(p))
        except Exception as e:  # noqa: BLE001
            # Do not raise: many callers just do a `if path.exists()` check,
            # which the parent LocalStorage contract also respects. Return
            # the (non-existent) cache path so callers get consistent
            # FileNotFoundError semantics down the line.
            logger.warning("Could not fetch %s from S3: %s", key, e)
        return p

    def ensure_ready(self) -> None:
        self.cache.mkdir(parents=True, exist_ok=True)
        try:
            self.client.head_bucket(Bucket=self.bucket)
            logger.info(
                "S3 storage ready: bucket=%s prefix=%s cache=%s",
                self.bucket,
                self.prefix or "(none)",
                self.cache,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "S3 bucket %s unreachable at startup (%s); will retry lazily",
                self.bucket,
                e,
            )


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------

def _build_s3_client(settings) -> Any:
    """Build a boto3 S3 client from settings. Uses the default credential
    chain when explicit keys are not provided."""
    import boto3

    kwargs: dict[str, Any] = {}
    if settings.s3_endpoint_url:
        kwargs["endpoint_url"] = settings.s3_endpoint_url
    if settings.s3_region:
        kwargs["region_name"] = settings.s3_region
    if settings.s3_access_key_id and settings.s3_secret_access_key:
        kwargs["aws_access_key_id"] = settings.s3_access_key_id
        kwargs["aws_secret_access_key"] = settings.s3_secret_access_key
    return boto3.client("s3", **kwargs)


@lru_cache
def get_storage() -> Storage:
    """Return the process-wide Storage singleton.

    Selection rule: if `S3_BUCKET` is set, return `S3Storage`; otherwise
    `LocalStorage`. Cached via lru_cache; call `reset_storage_cache()` in
    tests if you need to swap backends at runtime.
    """
    settings = get_settings()
    bucket = (settings.s3_bucket or "").strip()
    if not bucket:
        logger.info("Using LocalStorage at %s (S3_BUCKET not set)", settings.data_files_dir)
        return LocalStorage(settings.data_files_dir)

    client = _build_s3_client(settings)
    return S3Storage(
        bucket=bucket,
        prefix=(settings.s3_prefix or "").strip(),
        cache_dir=settings.data_files_dir,
        client=client,
    )


def reset_storage_cache() -> None:
    """Clear the `get_storage` cache. Intended for tests."""
    get_storage.cache_clear()
