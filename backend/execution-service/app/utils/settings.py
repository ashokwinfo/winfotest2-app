from functools import lru_cache
from urllib.parse import quote_plus
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENV: str = "development"

    CLIENT_DB_HOST: str = "host.docker.internal"
    CLIENT_DB_PORT: int = 5433
    CLIENT_DB_NAME: str = "playwright_client"
    CLIENT_DB_USER: str = "postgres"
    CLIENT_DB_PASSWORD: str = ""

    # Oracle ERP target URL (used by StepRunner to navigate before executing steps)
    ORACLE_ERP_URL: str = ""

    DEFAULT_BROWSER: str = "chromium"
    BROWSER_HEADLESS: bool = True
    BROWSER_SLOW_MO: int = 300
    BROWSER_TIMEOUT: int = 30000
    BROWSER_VIEWPORT_WIDTH: int = 1280
    BROWSER_VIEWPORT_HEIGHT: int = 800

    MAX_PARALLEL_WORKERS: int = 4
    VIDEOS_DIR: str = "/app/videos"

    # Screenshot capture mode: "all" | "on_failure" | "none"
    SCREENSHOT_MODE: str = "all"

    ENCRYPTION_KEY: str = ""
    SERVICE_PORT: int = 8003

    @property
    def client_db_url(self) -> str:
        return (
            f"postgresql+asyncpg://{quote_plus(self.CLIENT_DB_USER)}:{quote_plus(self.CLIENT_DB_PASSWORD)}"
            f"@{self.CLIENT_DB_HOST}:{self.CLIENT_DB_PORT}/{self.CLIENT_DB_NAME}"
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
