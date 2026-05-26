# Execution Service

Executes Playwright test scripts against Oracle ERP with full runtime controls.

**Port:** `8003`  
**Database:** `playwright_client`  
**Preview viewer:** `http://localhost:6080/vnc.html` (noVNC)

---

## Responsibilities

- Create and manage isolated test run workspaces (`test_run_steps`)
- Execute Playwright scripts step-by-step against Oracle ERP
- Pause / resume / stop execution at script and run level
- Live browser preview via noVNC (port 6080)
- Dynamic step injection while paused
- Live page element scanning (Auto Step Builder)
- Excel import/export of test run steps
- Real-time WebSocket events for frontend updates

---

## Project Structure

```
execution-service/
├── app/
│   ├── api/
│   │   └── routes/
│   │       ├── test_run_router.py      # All test run endpoints
│   │       ├── execution_router.py     # Direct run endpoints (Mode A)
│   │       └── playwright_control_router.py
│   ├── services/
│   │   ├── step_executor.py            # Core Playwright engine (Oracle ERP patterns)
│   │   ├── test_run_runner.py          # Orchestrator — manages runners
│   │   ├── runner_service.py           # Mode A direct execution
│   │   └── excel_service.py            # Import/export
│   ├── models/
│   │   └── test_run_models.py          # test_runs, test_run_scripts, etc.
│   ├── websockets/
│   │   └── execution_ws_handler.py     # WebSocket broadcast manager
│   └── utils/
│       ├── database.py                 # Async DB + get_db dependency
│       ├── settings.py                 # Pydantic settings
│       └── encryption.py
├── envs/
│   ├── dev.env.example                 # Copy to dev.env
│   └── prod.env.example
├── Dockerfile                          # Includes Google Chrome + Xvfb + noVNC
├── entrypoint.sh                       # Starts Xvfb, x11vnc, noVNC, then uvicorn
└── requirements.txt
```

---

## Environment Variables

Copy `envs/dev.env.example` to `envs/dev.env` and fill in:

```env
ENV=development
LOG_LEVEL=DEBUG

# Target Oracle ERP URL
ORACLE_ERP_URL=https://your-oracle-erp-url.com/

# Database (playwright_client)
CLIENT_DB_HOST=host.docker.internal
CLIENT_DB_PORT=5432
CLIENT_DB_NAME=playwright_client
CLIENT_DB_USER=postgres
CLIENT_DB_PASSWORD=your_password_here

# Browser settings
DEFAULT_BROWSER=chromium
BROWSER_HEADLESS=true
BROWSER_SLOW_MO=300
BROWSER_TIMEOUT=30000
BROWSER_VIEWPORT_WIDTH=1280
BROWSER_VIEWPORT_HEIGHT=800

# Execution settings
MAX_PARALLEL_WORKERS=4
SCREENSHOT_MODE=all        # all | on_failure | none
VIDEOS_DIR=/app/videos

# Security
ENCRYPTION_KEY=your_base64_key_here
SERVICE_PORT=8003
```

---

## Start

```bash
cd execution-service
docker compose up -d --build
```

---

## Execution Modes

### Mode A — Direct Run (simple)
Reads steps directly from `execution_steps`. No workspace isolation.

```
POST /api/v1/runs/
```

### Mode B — Test Run Workspace (full featured)
Copies steps into an isolated `test_run_steps` workspace before running.
Supports pause/resume/stop, step injection, Excel import/export.

```
POST /api/v1/test-runs/
```

---

## Key API Endpoints

### Test Run Workflow

| Step | Method | Endpoint |
|---|---|---|
| 1. Create run | POST | `/api/v1/test-runs/` |
| 2. Add scripts | POST | `/api/v1/test-runs/{run_id}/scripts` |
| 3. Verify steps | GET | `/api/v1/test-runs/{run_id}/scripts/{trs_id}/steps` |
| 4. Start | POST | `/api/v1/test-runs/{run_id}/start` |
| 5. View results | GET | `/api/v1/test-runs/{run_id}/scripts/{trs_id}/results` |

### Runtime Controls

| Method | Endpoint | Description |
|---|---|---|
| POST | `/{run_id}/scripts/{trs_id}/pause` | Pause a script |
| POST | `/{run_id}/scripts/{trs_id}/resume` | Resume a script |
| POST | `/{run_id}/scripts/{trs_id}/stop` | Stop a script |
| POST | `/{run_id}/pause-all` | Pause entire run |
| POST | `/{run_id}/resume-all` | Resume entire run |
| POST | `/{run_id}/stop-all` | Stop entire run |

### Preview

| Method | Endpoint | Description |
|---|---|---|
| POST | `/{run_id}/scripts/{trs_id}/start-preview` | Launch visible browser |
| POST | `/{run_id}/scripts/{trs_id}/stop-preview` | Close preview browser |
| GET | `/{run_id}/live-preview` | CDP screencast page |

### Auto Step Builder (while paused)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/{run_id}/scripts/{trs_id}/scan-elements` | Scan live page elements |
| POST | `/{run_id}/scripts/{trs_id}/get-options` | Get dropdown options |
| POST | `/{run_id}/scripts/{trs_id}/inject-step` | Inject a step |

### Excel

| Method | Endpoint | Description |
|---|---|---|
| GET | `/{run_id}/export-excel` | Export steps as XLSX |
| POST | `/{run_id}/import-excel/preview` | Preview import (no save) |
| POST | `/{run_id}/import-excel/confirm` | Apply import to DB |

Full docs: http://localhost:8003/docs

---

## WebSocket

Connect to receive real-time execution events:
```
ws://localhost:8003/api/v1/runs/ws/{run_id}
```

Events received:
```json
{"event": "script_started",   "payload": {"trs_id": "...", "total_steps": 49}}
{"event": "step_result",      "payload": {"step_no": 5, "status": "passed", "duration": 1240}}
{"event": "step_retry",       "payload": {"step_no": 5, "retry": 1, "error": "..."}}
{"event": "paused",           "payload": {"at_step_no": 5}}
{"event": "script_finished",  "payload": {"status": "completed", "passed": 49}}
{"event": "run_finished",     "payload": {"status": "completed", "passed": 1}}
{"event": "browser_frame",    "payload": {"data": "<base64 jpeg>"}}
```

---

## Database Schema (playwright_client — written by this service)

| Table | Description |
|---|---|
| `test_runs` | Top-level run record |
| `test_run_scripts` | Scripts added to a run (status per script) |
| `test_run_steps` | Isolated copy of steps — editable without affecting source |
| `test_run_step_results` | Per-step execution results with screenshots |

---

## Live Preview

The service runs Google Chrome inside Docker with a virtual display (Xvfb).

**View the browser:**
1. Call `POST /api/v1/test-runs/{run_id}/scripts/{trs_id}/start-preview`
2. Open **http://localhost:6080/vnc.html**
3. Click **Connect**

Ports used:
- `8003` — FastAPI
- `5900` — VNC (raw)
- `6080` — noVNC (browser-based viewer)

Make sure these are exposed in `docker-compose.yml`:
```yaml
ports:
  - "8003:8003"
  - "5900:5900"
  - "6080:6080"
```

---

## Oracle ERP Execution Patterns

The `step_executor.py` engine handles Oracle ERP-specific behaviour:

| Pattern | Handling |
|---|---|
| LOV dropdowns | Snapshot → fill → wait for field change |
| Spinbutton fields | fill() → Tab to commit |
| Oracle tiles/navigation | dispatch_event("click") fallback |
| Page redirects | `_get_active_page()` recovers stale page reference |
| Spinner/loading | Waits for spinner to disappear + DOM stability |
| Step failure | Stops execution, marks script failed, captures screenshot |

---

## Re-running a Test

After a run completes or fails, calling `POST /{run_id}/start` again automatically:
1. Clears previous `test_run_step_results`
2. Resets all script statuses to `pending`
3. Starts fresh execution

---

## Troubleshooting

**Chrome not found:**
```bash
docker exec ps_execution google-chrome --version
```
If missing, rebuild: `docker compose up -d --build execution-service`

**Steps not loading (GET /steps returns []):**
Make sure you called `POST /{run_id}/scripts` with the correct `execution_script_id` from Distribution Service:
```bash
curl http://localhost:8002/api/v1/workspace/scripts
```

**Import confirm not saving:**
The `script_map` key must match the `Script Name` column from the Excel file exactly. The response includes an `unmatched_scripts` field if nothing matched.

**Preview browser not showing:**
1. Check noVNC is running: `docker exec ps_execution ps aux | grep novnc`
2. Check Xvfb: `docker exec ps_execution ps aux | grep Xvfb`
3. Check logs: `docker logs ps_execution --tail=30`