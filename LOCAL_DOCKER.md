# Running Locally with Docker

This spins up the whole app (backend + frontend) on your own machine with
Docker — no Render, no live URL, everything at `localhost`. If you just want
to develop without Docker (`npm run dev` / `uvicorn --reload`), see the main
`README.md` instead; this guide is only for the Docker path.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- A MongoDB connection string (Atlas, or a local MongoDB) — this app doesn't run its own database container
- Your Firebase project already set up (see `RBAC_SETUP.md` if you haven't done this yet)

## 1. Backend secrets

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and fill in every value (Sarvam, Groq, MongoDB, Sarv, WhatsApp — see the comments in the file for where to get each one).

Also make sure `backend/firebase-service-account.json` exists (downloaded from Firebase Console → Project Settings → Service Accounts → Generate new private key).

## 2. Frontend secrets (used twice — see note below)

```bash
cd ../frontend
cp .env.example .env
```

Fill in the 7 `VITE_FIREBASE_*` values from Firebase Console → Project Settings → General → Your apps.

**Note:** `frontend/.env` is what plain `npm run dev` reads. Docker Compose does **not** read that file — it needs its *own* copy at the project root, because Vite bakes these values in at build time and Compose fills them in as build-args:

```bash
cd ..
cp .env.example .env
```

Fill in `.env` (project root) with the **same** 7 `VITE_FIREBASE_*` values as `frontend/.env`.

## 3. Build and run

From the project root (same folder as `docker-compose.yml`):

```bash
docker compose up --build
```

First run takes a few minutes (installing dependencies, building the frontend). Once it settles:

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:8000 (try http://localhost:8000/health — should show `{"status":"ok","mongodb_connected":true}`)
- **API docs**: http://localhost:8000/docs

Stop everything with `Ctrl+C`, or `docker compose down` from another terminal.

## 4. Sign in

The very first account to sign in (email/password or Google) automatically becomes **Super Admin** — see `RBAC_SETUP.md` for the full walkthrough of creating other users afterward.

## Making code changes

This setup **rebuilds from scratch** each time — it does not hot-reload like `npm run dev` does. After editing backend or frontend code:

```bash
docker compose up --build
```

(`--build` forces Docker to rebuild the changed image; without it, Compose reuses the old one and your changes won't show up.)

For active day-to-day development, running the backend/frontend directly with `uvicorn --reload` and `npm run dev` (see main `README.md`) is faster — use this Docker setup mainly to sanity-check that everything still works the same way it will when deployed.

## Troubleshooting

- **"Firebase service account not found"** — `backend/firebase-service-account.json` is missing, or Docker couldn't mount it. Confirm the file exists at that exact path before running `docker compose up --build`.
- **Frontend shows "Firebase setup needed"** — the root-level `.env` (step 2) is missing or incomplete. Remember this is separate from `frontend/.env`.
- **Backend can't reach MongoDB** — check `MONGODB_URI` in `backend/.env`; if using Atlas, make sure your current IP is allowed under Network Access.
- **Port already in use** — something else on your machine is already using 5173 or 8000. Either stop that other process, or change the left-hand side of the port mapping in `docker-compose.yml` (e.g. `"5174:80"`) and use that port instead.
