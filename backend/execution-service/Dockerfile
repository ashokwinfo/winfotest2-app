FROM python:3.11-slim

# System dependencies — Playwright, Xvfb, x11vnc, noVNC, Chrome
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget gnupg ca-certificates \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    libx11-6 libx11-xcb1 libxcb1 libxext6 \
    fonts-liberation xdg-utils procps \
    xvfb x11vnc x11-utils novnc websockify \
    && rm -rf /var/lib/apt/lists/*

# Google Chrome (bypasses Oracle ERP bot-detection better than Chromium)
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget libpq-dev \
    && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y --no-install-recommends ./google-chrome-stable_current_amd64.deb \
    && rm google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/* \
    && google-chrome --version

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright Chromium as fallback
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install chromium

COPY app/ ./app/
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

RUN find app -type d -exec touch {}/__init__.py \; 2>/dev/null || true
RUN mkdir -p /app/videos /tmp

# Ports: 8003 = API, 5900 = VNC, 6080 = noVNC (preview viewer)
EXPOSE 8003 5900 6080

ENV DISPLAY=:99

CMD ["./entrypoint.sh"]