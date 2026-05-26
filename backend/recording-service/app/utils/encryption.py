import base64
import hashlib
from cryptography.fernet import Fernet, InvalidToken
from app.utils.settings import settings


class EncryptionError(Exception):
    pass


class EncryptionService:
    def __init__(self):
        raw = settings.ENCRYPTION_KEY
        if not raw:
            raise EncryptionError("ENCRYPTION_KEY is not set.")
        try:
            self._f = Fernet(raw.encode())
        except Exception:
            derived = base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())
            self._f = Fernet(derived)

    def encrypt(self, plaintext: str) -> str:
        return self._f.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        try:
            return self._f.decrypt(ciphertext.encode()).decode()
        except InvalidToken as e:
            raise EncryptionError("Decryption failed.") from e

    @staticmethod
    def hash_code(plaintext: str) -> str:
        return hashlib.sha256(plaintext.encode()).hexdigest()


encryption_service = EncryptionService()
