from functools import lru_cache
from urllib.parse import quote_plus
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENV: str = "development"
    LOG_LEVEL: str = "INFO"

    ORACLE_ERP_URL: str = ""

    MASTER_DB_HOST: str = "host.docker.internal"
    MASTER_DB_PORT: int = 5432
    MASTER_DB_NAME: str = "playwright_master"
    MASTER_DB_USER: str = "postgres"
    MASTER_DB_PASSWORD: str = ""

    DEFAULT_BROWSER: str = "chromium"
    BROWSER_HEADLESS: bool = False
    BROWSER_SLOW_MO: int = 0
    BROWSER_TIMEOUT: int = 60000
    BROWSER_VIEWPORT_WIDTH: int = 1280
    BROWSER_VIEWPORT_HEIGHT: int = 800

    ENCRYPTION_KEY: str = ""
    SERVICE_PORT: int = 8001

    # Chrome CDP port for recording (non-headless)
    CHROME_CDP_PORT: int = 9223

    @property
    def master_db_url(self) -> str:
        return (
            f"postgresql+asyncpg://{quote_plus(self.MASTER_DB_USER)}:{quote_plus(self.MASTER_DB_PASSWORD)}"
            f"@{self.MASTER_DB_HOST}:{self.MASTER_DB_PORT}/{self.MASTER_DB_NAME}"
            f"?ssl=disable"
        )

    @property
    def viewport(self) -> dict:
        return {"width": self.BROWSER_VIEWPORT_WIDTH, "height": self.BROWSER_VIEWPORT_HEIGHT}

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
