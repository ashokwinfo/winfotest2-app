FROM python:3.11-slim

# ── System dependencies + Google Chrome (CDP non-headless via WSLg DISPLAY=:0) ──
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget xvfb x11-utils ca-certificates gnupg curl libpq-dev \
        libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
        libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
        libgbm1 libasound2 libpango-1.0-0 libcairo2 \
        libx11-6 libx11-xcb1 libxcb1 libxext6 \
        fonts-liberation xdg-utils procps \
    && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y --no-install-recommends ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/* \
    && google-chrome --version

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright's Chromium as a fallback when Google Chrome is not found
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install chromium

COPY app/ ./app/
RUN find app -type d -exec touch {}/__init__.py \; 2>/dev/null || true

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]