"""
Initializes the Firebase Admin SDK, used to (a) verify ID tokens sent by the
frontend on every API request, and (b) let Admin/Super Admin users create,
disable, and delete accounts from the User Management panel.

Put your service account key JSON (Firebase Console -> Project Settings ->
Service Accounts -> Generate new private key) at the path below, or point
FIREBASE_SERVICE_ACCOUNT_PATH at it via .env. Never commit this file.
"""
import os

import firebase_admin
from firebase_admin import credentials

_DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "firebase-service-account.json")
SERVICE_ACCOUNT_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", _DEFAULT_PATH)

_app = None
_init_error: str | None = None


def get_firebase_app():
    """Returns the initialized Firebase app, initializing it on first use.
    Raises a clear RuntimeError (turned into a 503 by auth.py) if the service
    account file hasn't been added yet, instead of crashing the whole API on
    startup — so the rest of the app still runs while this gets set up."""
    global _app, _init_error
    if _app is not None:
        return _app
    if _init_error is not None:
        raise RuntimeError(_init_error)
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        _init_error = (
            f"Firebase service account not found at {SERVICE_ACCOUNT_PATH}. "
            "Download it from Firebase Console > Project Settings > Service Accounts "
            "and save it there (or set FIREBASE_SERVICE_ACCOUNT_PATH in .env)."
        )
        raise RuntimeError(_init_error)
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    _app = firebase_admin.initialize_app(cred)
    return _app
