import os

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import check_connection
from app.routers import speech, stt, campaigns

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


@app.get("/")
def root():
    # Kept intentionally minimal - this backend has no UI of its own, this
    # just avoids a confusing 404 if someone opens the bare backend URL.
    return {"service": "OBD Suite API", "status": "running", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok", "mongodb_connected": check_connection()}
