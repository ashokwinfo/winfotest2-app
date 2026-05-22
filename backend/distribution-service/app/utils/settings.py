from functools import lru_cache
from urllib.parse import quote_plus
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENV: str = "development"

    # Client DB (destination for published scripts)
    CLIENT_DB_HOST:     str = "host.docker.internal"
    CLIENT_DB_PORT:     int = 5433
    CLIENT_DB_NAME:     str = "playwright_client"
    CLIENT_DB_USER:     str = "postgres"
    CLIENT_DB_PASSWORD: str = ""

    ENCRYPTION_KEY: str = ""
    EXPORT_DIR:     str = "/app/exports"
    SERVICE_PORT:   int = 8002

    # Recording Service URL — Distribution Service calls this instead of
    # connecting to Master DB directly.
    RECORDING_SERVICE_URL: str = "http://ps_recording:8001"

    @property
    def client_db_url(self) -> str:
        return (
            f"postgresql+asyncpg://{quote_plus(self.CLIENT_DB_USER)}:{quote_plus(self.CLIENT_DB_PASSWORD)}"
            f"@{self.CLIENT_DB_HOST}:{self.CLIENT_DB_PORT}/{self.CLIENT_DB_NAME}"
            f"?ssl=disable"
        )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()