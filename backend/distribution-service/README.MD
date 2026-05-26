# Distribution Service

Publishes recorded scripts from the Master DB to the Client DB and provides a workspace for editing steps before execution.

**Port:** `8002`  
**Database:** `playwright_client`

---

## Responsibilities

- Publish test scripts from Recording Service → Client DB (`execution_scripts`, `execution_steps`)
- Workspace for editing published steps (add, update, delete, reorder)
- Excel import/export of test steps
- Does **not** connect to `playwright_master` directly — fetches via Recording Service API

---

## Project Structure

```
distribution-service/
├── app/
│   ├── api/
│   │   └── routes/
│   │       ├── publish_router.py      # Publish scripts from master
│   │       └── workspace_router.py    # Edit execution_steps
│   ├── services/
│   │   ├── publish_service.py         # Calls recording service export API
│   │   └── excel_service.py           # Excel import/export
│   ├── models/                        # SQLAlchemy table definitions
│   └── utils/
│       ├── database.py
│       └── settings.py
├── envs/
│   ├── dev.env.example
│   └── prod.env.example
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

---

## Environment Variables

Copy `envs/dev.env.example` to `envs/dev.env` and fill in:

```env
ENV=development

# Database (playwright_client)
CLIENT_DB_HOST=host.docker.internal
CLIENT_DB_PORT=5432
CLIENT_DB_NAME=playwright_client
CLIENT_DB_USER=postgres
CLIENT_DB_PASSWORD=your_password_here

# Recording service URL (for fetching script exports)
RECORDING_SERVICE_URL=http://host.docker.internal:8001

SERVICE_PORT=8002
```

---

## Start

```bash
cd distribution-service
docker compose up -d --build
```

---

## Key API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/v1/publish` | Publish scripts to client DB |
| GET | `/api/v1/workspace/scripts` | List published scripts |
| GET | `/api/v1/workspace/scripts/{id}/steps` | List steps for a script |
| POST | `/api/v1/workspace/scripts/{id}/steps` | Add a manual step |
| PATCH | `/api/v1/workspace/steps/{id}` | Update a step |
| DELETE | `/api/v1/workspace/steps/{id}` | Delete a step |
| POST | `/api/v1/workspace/scripts/{id}/steps/reorder` | Reorder steps |

Full docs: http://localhost:8002/docs

---

## Database Schema (playwright_client — written by this service)

Key tables:

| Table | Description |
|---|---|
| `imported_releases` | Mirror of master releases |
| `imported_modules` | Mirror of master modules |
| `imported_features` | Mirror of master features |
| `execution_scripts` | Published scripts (release_id assigned at publish time) |
| `execution_steps` | Published steps — `selector` column is backend-only |

### Important column mapping in `execution_steps`

| DB Column | Meaning |
|---|---|
| `selector` | Playwright locator code — **backend-only, never returned in API** |
| `value` | Test data value (e.g. username, field input) |
| `metadata` | JSON with `input_type`, `input_parameter`, `wait_ms`, etc. |

---

## Publish Flow

```
Recording Service (port 8001)
  └── POST /api/v1/recording/export-zip
        ↓
Distribution Service (port 8002)
  └── POST /api/v1/publish
        ↓
  playwright_client DB
  └── execution_scripts + execution_steps
```

---

## Step Shift Pattern

When adding/deleting steps, a temp offset (+1000) is used to avoid unique constraint violations on `step_order`:

```
Shift up:   step_order += 1000, then step_order -= 999  (net: +1)
Shift down: step_order += 1000, then step_order -= 1001 (net: -1)
```