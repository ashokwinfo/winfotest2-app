import base64, hashlib
from cryptography.fernet import Fernet, InvalidToken
from app.utils.settings import settings

class EncryptionError(Exception): pass

class EncryptionService:
    def __init__(self):
        raw = settings.ENCRYPTION_KEY
        if not raw: raise EncryptionError("ENCRYPTION_KEY not set.")
        try: self._f = Fernet(raw.encode())
        except Exception:
            self._f = Fernet(base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest()))

    def decrypt(self, ct: str) -> str:
        try: return self._f.decrypt(ct.encode()).decode()
        except InvalidToken as e: raise EncryptionError("Bad token.") from e

    def encrypt(self, pt: str) -> str:
        return self._f.encrypt(pt.encode()).decode()

encryption_service = EncryptionService()
