#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  entrypoint.sh — Execution Service container startup
#
#  Boot order:
#    1. Clean stale X lock files
#    2. Xvfb on :99  (virtual display for headless=False preview)
#    3. x11vnc        (VNC server mirroring :99)
#    4. noVNC         (browser-accessible VNC viewer at port 6080)
#    5. uvicorn       (FastAPI execution service)
# ═══════════════════════════════════════════════════════════════════════════
set -e

# ── 1. Clean stale X lock files ──────────────────────────────────────────────
rm -f /tmp/.X99-lock /tmp/.X98-lock /tmp/.X11-unix/X99 2>/dev/null || true

# ── 2. Xvfb — virtual display ────────────────────────────────────────────────
echo "[entrypoint] Starting Xvfb on :99 ..."
Xvfb :99 -screen 0 1280x800x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
export DISPLAY=:99

# Poll until Xvfb is ready (max 10 s)
for i in $(seq 1 20); do
    xdpyinfo -display :99 >/dev/null 2>&1 && break
    sleep 0.5
done

if ! xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "[entrypoint] WARNING: Xvfb may not be ready — continuing anyway"
else
    echo "[entrypoint] Xvfb ready (pid=$XVFB_PID, DISPLAY=:99)"
fi

# ── 3. x11vnc — VNC server ───────────────────────────────────────────────────
echo "[entrypoint] Starting x11vnc on :5900 ..."
x11vnc \
    -display :99 \
    -nopw \
    -listen 0.0.0.0 \
    -port 5900 \
    -xkb \
    -noxrecord -noxfixes -noxdamage \
    -forever -shared \
    -bg -quiet \
    -logfile /tmp/x11vnc.log 2>/dev/null || \
    echo "[entrypoint] x11vnc not available — VNC viewing disabled"

# ── 4. noVNC — browser-accessible VNC viewer ─────────────────────────────────
echo "[entrypoint] Starting noVNC on :6080 ..."
NOVNC_ROOT=""
for candidate in /usr/share/novnc /opt/novnc /usr/local/share/novnc; do
    if [ -f "${candidate}/vnc.html" ] || [ -f "${candidate}/vnc_lite.html" ]; then
        NOVNC_ROOT="${candidate}"; break
    fi
done

if [ -n "${NOVNC_ROOT}" ]; then
    websockify \
        --web="${NOVNC_ROOT}" \
        --daemon \
        --log-file=/tmp/novnc.log \
        0.0.0.0:6080 localhost:5900 2>/dev/null || true
    echo "[entrypoint] noVNC ready → http://localhost:6080/vnc.html"
else
    echo "[entrypoint] noVNC not found — browser VNC viewer unavailable"
fi

# ── 5. FastAPI / Uvicorn ──────────────────────────────────────────────────────
echo ""
echo "  ✅  Execution Service ready"
echo "  ✅  API    → http://localhost:8003"
echo "  ✅  noVNC  → http://localhost:6080/vnc.html  (watch preview browser here)"
echo ""

exec env DISPLAY=:99 uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8003 \
    --workers 1 \
    --loop asyncio