import logging
import os

from dotenv import load_dotenv
load_dotenv()

# Without this, Python's root logger defaults to WARNING level, so every
# logger.info(...) call in the app (e.g. the Sarv webhook's "callback
# received" log) is silently dropped and never shows up in Render's logs -
# even though the request itself is processed successfully (200 OK).
import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import check_connection, ensure_indexes
from app.routers import speech, stt, campaigns, users, whatsapp

app = FastAPI(title="OBD Suite API", version="1.0.0")

# Comma-separated list of allowed frontend origins, e.g.
# "https://obd-frontend-xhzq.onrender.com,http://localhost:5173"
# Falls back to "*" only when nothing is configured, so local/dev setups
# that never set this keep working exactly as before.
_allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()
_allowed_origins = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(speech.router)
app.include_router(stt.router)
app.include_router(campaigns.router)
app.include_router(users.router)
app.include_router(whatsapp.router)


@app.on_event("startup")
def _startup():
    ensure_indexes()


@app.get("/")
def root():
    # Kept intentionally minimal - this backend has no UI of its own, this
    # just avoids a confusing 404 if someone opens the bare backend URL.
    return {"service": "OBD Suite API", "status": "running", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok", "mongodb_connected": check_connection()}
