"""Tests for app.services.storage.

LocalStorage tests run against a tempdir. S3Storage tests use a stub boto3
client injected directly so no AWS credentials or network are required.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.services import storage
from app.services.storage import LocalStorage, S3Storage, get_storage, reset_storage_cache


# ---------------------------------------------------------------------------
# LocalStorage
# ---------------------------------------------------------------------------

def test_local_write_read_roundtrip(tmp_path):
    s = LocalStorage(str(tmp_path))
    s.ensure_ready()
    s.write_bytes("user-1/file.csv", b"hello,world\n1,2\n")

    assert s.exists("user-1/file.csv")
    p = s.local_path("user-1/file.csv")
    assert p.exists()
    assert p.read_bytes() == b"hello,world\n1,2\n"


def test_local_delete_is_idempotent(tmp_path):
    s = LocalStorage(str(tmp_path))
    s.write_bytes("a/b.txt", b"x")
    s.delete("a/b.txt")
    assert not s.exists("a/b.txt")
    s.delete("a/b.txt")  # must not raise
    s.delete("never/existed.txt")


def test_local_rejects_path_traversal(tmp_path):
    s = LocalStorage(str(tmp_path))
    with pytest.raises(ValueError):
        s._abs("../../etc/passwd")
    # exists() with a traversal key must simply report False, never escape.
    assert s.exists("../outside.txt") is False


def test_local_ensure_ready_creates_base(tmp_path):
    base = tmp_path / "nested" / "data_files"
    assert not base.exists()
    LocalStorage(str(base)).ensure_ready()
    assert base.exists()


# ---------------------------------------------------------------------------
# S3Storage (with a stub client)
# ---------------------------------------------------------------------------

class _StubS3Client:
    """In-memory boto3 S3 client stand-in. Captures calls and lets tests
    pre-populate objects to simulate downloads."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.calls: list[tuple[str, dict]] = []

    # Boto3 API we rely on --------------------------------------------------

    def put_object(self, *, Bucket, Key, Body):
        self.calls.append(("put_object", {"Bucket": Bucket, "Key": Key}))
        self.objects[Key] = Body

    def delete_object(self, *, Bucket, Key):
        self.calls.append(("delete_object", {"Bucket": Bucket, "Key": Key}))
        self.objects.pop(Key, None)

    def head_object(self, *, Bucket, Key):
        self.calls.append(("head_object", {"Bucket": Bucket, "Key": Key}))
        if Key not in self.objects:
            raise RuntimeError(f"NoSuchKey {Key}")
        return {"ContentLength": len(self.objects[Key])}

    def head_bucket(self, *, Bucket):
        self.calls.append(("head_bucket", {"Bucket": Bucket}))
        return {}

    def download_file(self, Bucket, Key, Filename):
        self.calls.append(("download_file", {"Bucket": Bucket, "Key": Key, "Filename": Filename}))
        if Key not in self.objects:
            raise RuntimeError(f"NoSuchKey {Key}")
        Path(Filename).parent.mkdir(parents=True, exist_ok=True)
        Path(Filename).write_bytes(self.objects[Key])


@pytest.fixture
def stub_s3(tmp_path):
    client = _StubS3Client()
    s = S3Storage(
        bucket="test-bucket",
        prefix="data-talks/prod",
        cache_dir=str(tmp_path / "cache"),
        client=client,
    )
    s.ensure_ready()
    return s, client


def test_s3_write_uploads_and_mirrors_to_cache(stub_s3):
    s, client = stub_s3
    s.write_bytes("u1/x.csv", b"abc")

    # Uploaded to S3 under the prefixed key
    assert client.objects["data-talks/prod/u1/x.csv"] == b"abc"
    # Mirrored to local cache so local_path is fast
    assert s.local_path("u1/x.csv").read_bytes() == b"abc"


def test_s3_local_path_downloads_on_cache_miss(stub_s3):
    s, client = stub_s3
    # Simulate another process uploading to S3 without touching our cache
    client.objects["data-talks/prod/shared/y.txt"] = b"from-s3"

    p = s.local_path("shared/y.txt")
    assert p.exists()
    assert p.read_bytes() == b"from-s3"
    assert ("download_file", {"Bucket": "test-bucket", "Key": "data-talks/prod/shared/y.txt", "Filename": str(p)}) in client.calls


def test_s3_delete_removes_from_both(stub_s3):
    s, client = stub_s3
    s.write_bytes("u1/z.csv", b"gone")
    assert s.exists("u1/z.csv")

    s.delete("u1/z.csv")
    assert "data-talks/prod/u1/z.csv" not in client.objects
    assert not s.local_path("u1/z.csv").exists()


def test_s3_exists_falls_back_to_head_when_cache_miss(stub_s3):
    s, client = stub_s3
    client.objects["data-talks/prod/only-in-s3.bin"] = b"x"
    assert s.exists("only-in-s3.bin") is True
    assert s.exists("nowhere.bin") is False


def test_s3_empty_key_rejected(stub_s3):
    s, _ = stub_s3
    with pytest.raises(ValueError):
        s.write_bytes("", b"x")


def test_s3_path_traversal_rejected(stub_s3):
    s, client = stub_s3
    # Write to a safe key first, then try to read a traversal key
    with pytest.raises(ValueError):
        s._cache_path("../escape.txt")


# ---------------------------------------------------------------------------
# get_storage selection
# ---------------------------------------------------------------------------

def test_get_storage_defaults_to_local(monkeypatch, tmp_path):
    monkeypatch.setenv("S3_BUCKET", "")
    monkeypatch.setenv("DATA_FILES_DIR", str(tmp_path))
    # Reset the lru_cache and the settings cache (pydantic-settings is
    # wrapped in @lru_cache via app.config.get_settings).
    from app.config import get_settings
    get_settings.cache_clear()
    reset_storage_cache()

    s = get_storage()
    assert isinstance(s, LocalStorage)
