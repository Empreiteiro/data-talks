"""Tests for app.services.crypto (Fernet + HKDF fallback)."""
from app.services import crypto


def test_encrypt_decrypt_roundtrip():
    crypto.get_fernet.cache_clear()
    plain = "ghp_1234567890abcdef"
    cipher = crypto.encrypt_text(plain)
    assert cipher != plain
    assert crypto.decrypt_text(cipher) == plain


def test_decrypt_empty_returns_empty():
    crypto.get_fernet.cache_clear()
    assert crypto.decrypt_text("") == ""


def test_encrypt_unicode():
    crypto.get_fernet.cache_clear()
    plain = "çãõ 你好 🚀"
    assert crypto.decrypt_text(crypto.encrypt_text(plain)) == plain


def test_key_derivation_deterministic():
    """Same SECRET_KEY must produce the same Fernet key, so tokens persist across restarts."""
    crypto.get_fernet.cache_clear()
    f1 = crypto.get_fernet()
    crypto.get_fernet.cache_clear()
    f2 = crypto.get_fernet()
    # Encrypting with f1 should be decryptable by f2.
    token = f1.encrypt(b"hello").decode("ascii")
    assert f2.decrypt(token.encode("ascii")) == b"hello"
