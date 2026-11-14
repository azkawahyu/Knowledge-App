# Knowledge-App

A local-first knowledge management application for ingesting documents, searching their contents, and chatting with your own knowledge base. Everything runs on your machine — the backend binds to `127.0.0.1` only and is never exposed to a network.

## What This App Does

Knowledge-App turns a folder of documents into a searchable, queryable knowledge base:

1. **Ingest** — upload documents (PDF, DOCX, XLSX, scanned images). Each file is parsed, text is extracted (with Tesseract.js OCR for images), and the text is split into chunks.
2. **Store** — documents and chunks are persisted in PostgreSQL with GIN full-text search indexes, SHA-256 deduplication, and per-document access policies.
3. **Retrieve** — keyword/full-text search across all ingested chunks, filterable by access policy.
4. **Chat** — an AI assistant (via an OpenAI-compatible API, e.g. OpenAgentic) that answers questions grounded in retrieved document chunks, with conversation history and audit logging.

### Key Features

- Web dashboard with **Library** (document management), **Inbox**, **Retrieve** (search), **Chat**, and **Audit** pages
- JWT-based admin authentication (bcrypt password hashing)
- Automatic schema creation on first startup; initial admin account seeded from `.env`
- Audit log of ingests, searches, and chat activity
- Synchronous ingestion — documents are searchable immediately after upload
- Supported formats: `.pdf` (pdftotext), `.docx`, `.xlsx`, and images (`.png`, `.jpg`, `.tif`) via OCR

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, Express 4 |
| Database | PostgreSQL (pgcrypto, JSONB, GIN full-text indexes) |
| Document parsing | pdftotext CLI (PDF), `docx`, SheetJS `xlsx`, `cheerio`, `adm-zip` |
| OCR | Tesseract.js (bundled `eng.traineddata`) |
| Auth & security | `jsonwebtoken`, `bcryptjs`, `helmet`, `express-rate-limit`, `multer` |
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS 3 |
| Dev tooling | `tsx` (dev server), `concurrently` (single-command dev), `dotenv` |
| AI chat | Any OpenAI-compatible `/chat/completions` endpoint (configured via `.env`) |

## Requirements

- Windows 10/11 (works anywhere Node + PostgreSQL run)
- Node.js and npm
- A local PostgreSQL instance that is running and accessible
- A created PostgreSQL database — the backend creates the tables itself on first run
- `pdftotext` (poppler) on PATH for PDF parsing

## Step-by-Step Usage

### 1. Configure the backend

Copy `server/.env.example` to `server/.env` and fill it in:

```dotenv
PORT=4000
HOST=127.0.0.1
DATABASE_URL=postgresql://USER:***@127.0.0.1:5432/DATABASE
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_TO_A_STRONG_PASSWORD
JWT_SECRET=CHANGE_TO_A_LONG_RANDOM_SECRET
OPENAI_BASE_URL=https://openagentic.id/api/v1
OPENAI_MODEL=gpt-6-luna
OPENAI_API_KEY=
OPENAI_MAX_TOKENS=2048
LOG_LEVEL=info
```

- Replace the database user, password, and name with your local PostgreSQL credentials. URL-encode special characters in the password inside `DATABASE_URL`.
- Set `OPENAI_API_KEY` to your provider key. Never send the key through chat or put it in the frontend — chat messages, history, and matched document chunks are sent from the backend to the provider to generate answers.
- Example SQL for creating the database/user is in `server/create_db.sql` and `server/create_user.sql`; adjust credentials before use.

### 2. Start PostgreSQL

Make sure PostgreSQL is running before starting the backend. `server/start_postgres.bat` targets an install at `D:\Install\PostgreSQL\18` — adjust the path if yours differs.

### 3. Install and run

From the project root:

```bash
npm install
npm run dev
```

`npm run dev` starts the backend (`http://127.0.0.1:4000`) and the frontend (`http://localhost:3000`) together. To run either half alone:

```bash
npm run dev:server
npm run dev:web
```

Stop both with `Ctrl+C`.

### 4. Log in and use the app

1. Open <http://localhost:3000> and log in with the admin credentials from `server/.env`.
2. **Library** — upload documents. They are parsed, chunked, and indexed immediately (status becomes `ready`).
3. **Retrieve** — run keyword searches across all ingested documents; results show the matching chunk, document name, and page number.
4. **Chat** — ask questions about your knowledge base; answers are grounded in retrieved chunks, with a summarize/overview mode for a knowledge-base-wide summary (matches on "rangkum", "summary", "overview", etc.).
5. **Audit** — review the log of security-relevant actions.

On first startup the backend creates all tables and seeds the initial admin account from `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

### 5. Build and lint

```bash
npm run build   # compiles the backend (tsc) then the frontend (next build)
npm run lint    # ESLint on the frontend
```

Note: lint currently reports ESLint errors (including `any` usages). The frontend build ignores lint per its Next.js config — a successful build does not mean lint passes.

## Security Notes

- Never commit or share `server/.env` — it holds secrets and is git-ignored.
- Change the default admin password and `JWT_SECRET`.
- Do not change `HOST` to `0.0.0.0` or expose the ports to a public network; the app is designed for localhost-only use.
