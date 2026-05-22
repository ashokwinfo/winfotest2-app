# Recording Service

Manages the Oracle ERP test script hierarchy and browser recording sessions.

**Port:** `8001`  
**Database:** `playwright_master`

---

## Responsibilities

- Product / Release / Module / Feature / Process hierarchy management
- Test script creation with auto-generated case numbers
- Live browser recording via Playwright CDP
- Master step storage (locator code encrypted, never exposed via API)
- Script export for Distribution Service

---

## Project Structure

```
recording-service/
├── app/
│   ├── api/
│   │   └── routes/
│   │       ├── hierarchy_router.py    # Products, modules, features, processes
│   │       ├── script_router.py       # Test scripts CRUD
│   │       └── recording_router.py    # Start/stop recording sessions
│   ├── services/
│   │   ├── recording_service.py       # Playwright browser recording logic
│   │   └── export_service.py          # ZIP export for distribution
│   ├── models/                        # SQLAlchemy table definitions
│   └── utils/
│       ├── database.py                # Async DB connection
│       ├── settings.py                # Pydantic settings
│       └── encryption.py             # AES encryption for locator_code
├── envs/
│   ├── dev.env.example               # Copy to dev.env
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

# Database (playwright_master)
MASTER_DB_HOST=host.docker.internal
MASTER_DB_PORT=5432
MASTER_DB_NAME=playwright_master
MASTER_DB_USER=postgres
MASTER_DB_PASSWORD=your_password_here

# Security
ENCRYPTION_KEY=your_base64_encryption_key_here

SERVICE_PORT=8001
```

**Generate an encryption key:**
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

---

## Start

```bash
cd recording-service
docker compose up -d --build
```

---

## Key API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/v1/products` | Create product |
| GET | `/api/v1/modules?product_id=` | List modules |
| POST | `/api/v1/scripts/` | Create test script |
| GET | `/api/v1/scripts/{id}/steps` | Get master steps |
| POST | `/api/v1/recording/start` | Start browser recording |
| POST | `/api/v1/recording/stop` | Stop recording & save steps |
| POST | `/api/v1/recording/export-zip` | Export scripts for distribution |

Full docs: http://localhost:8001/docs

---

## Database Schema (playwright_master)

Key tables:

| Table | Description |
|---|---|
| `products` | Top-level Oracle ERP application |
| `releases` | Version labels (e.g. 26A, 26B) |
| `modules` | Functional areas (e.g. Procurement) |
| `features` | Sub-areas (e.g. Purchase Orders) |
| `test_scripts` | Test cases with auto-generated case numbers |
| `master_steps` | Recorded steps — `locator_code` is backend-only |
| `recording_sessions` | Active browser recording sessions |

---

## Security Note

`master_steps.locator_code` contains Playwright selector templates. This column is **never returned** in any API response — it is backend-only and stored encrypted.