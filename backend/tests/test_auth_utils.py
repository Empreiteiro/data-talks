"""Unit tests for authentication utility functions."""
import pytest
from app.auth import hash_password, verify_password, create_access_token, decode_token


class TestHashPassword:
    def test_returns_hashed_string(self):
        result = hash_password("mypassword")
        assert isinstance(result, str)
        assert result != "mypassword"

    def test_empty_password_does_not_raise(self):
        result = hash_password("")
        assert isinstance(result, str)

    def test_long_password_truncated_safely(self):
        long_pw = "a" * 100
        result = hash_password(long_pw)
        assert isinstance(result, str)

    def test_different_calls_produce_different_hashes(self):
        h1 = hash_password("same")
        h2 = hash_password("same")
        # bcrypt uses random salt, so each call is unique
        assert h1 != h2


class TestVerifyPassword:
    def test_correct_password_returns_true(self):
        hashed = hash_password("secret")
        assert verify_password("secret", hashed) is True

    def test_wrong_password_returns_false(self):
        hashed = hash_password("secret")
        assert verify_password("wrong", hashed) is False

    def test_empty_plain_returns_false(self):
        hashed = hash_password("secret")
        assert verify_password("", hashed) is False


class TestJwtTokens:
    def test_create_and_decode_roundtrip(self):
        payload = {"sub": "user-123"}
        token = create_access_token(payload)
        decoded = decode_token(token)
        assert decoded is not None
        assert decoded["sub"] == "user-123"

    def test_decode_invalid_token_returns_none(self):
        result = decode_token("not.a.valid.token")
        assert result is None

    def test_decode_tampered_token_returns_none(self):
        token = create_access_token({"sub": "user-123"})
        tampered = token[:-5] + "XXXXX"
        assert decode_token(tampered) is None

    def test_token_contains_expiry(self):
        token = create_access_token({"sub": "user-abc"})
        decoded = decode_token(token)
        assert "exp" in decoded

    def test_token_is_string(self):
        token = create_access_token({"sub": "user-abc"})
        assert isinstance(token, str)
