"""
Every protected route depends on get_current_user (or one of the
require_*() wrappers below), which:
  1. reads the Firebase ID token from the Authorization header
  2. verifies it with the Firebase Admin SDK (so it can't be forged)
  3. looks up (or, for the very first user ever, bootstraps) the matching
     profile + role + permissions in MongoDB

This is what actually secures the API — the frontend hiding menu items is
just UX, not security. Every mutating/sensitive endpoint must depend on one
of require_role() / require_permission() below, not just get_current_user.
"""
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from firebase_admin import auth as firebase_auth

from .database import users_collection
from .firebase_admin_client import get_firebase_app
from .permissions import default_permissions_for_role


def _extract_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    return header[len("Bearer "):].strip()


def get_current_user(request: Request) -> dict:
    """Verifies the caller's Firebase ID token and returns their MongoDB
    profile document (creating it on their very first authenticated
    request). The first user to ever hit this in a fresh database becomes
    super_admin automatically — every other new user starts as role="user"
    with zero modules assigned, until an admin grants some."""
    token = _extract_token(request)
    try:
        get_firebase_app()
        decoded = firebase_auth.verify_id_token(token)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception:
        raise HTTPException(401, "Invalid or expired session. Please sign in again.")

    uid = decoded["uid"]
    profile = users_collection.find_one({"uid": uid})

    if profile is None:
        is_first_user_ever = users_collection.count_documents({}) == 0
        role = "super_admin" if is_first_user_ever else "user"
        perms = default_permissions_for_role(role)
        profile = {
            "uid": uid,
            "email": decoded.get("email", ""),
            "name": decoded.get("name") or (decoded.get("email", "").split("@")[0]),
            "role": role,
            "modules": perms["modules"],
            "services": perms["services"],
            "fields": perms["fields"],
            "active": True,
            "created_by": "self:bootstrap" if is_first_user_ever else "self:signup",
            "created_at": datetime.now(timezone.utc),
        }
        users_collection.insert_one(profile)

    if not profile.get("active", True):
        raise HTTPException(403, "This account has been deactivated. Contact your admin.")

    profile["_id"] = str(profile["_id"])
    return profile


def has_permission(user: dict, module: str, service: str | None = None) -> bool:
    if user["role"] in ("super_admin", "admin"):
        return True
    if module not in (user.get("modules") or []):
        return False
    if service is None:
        return True
    return f"{module}:{service}" in (user.get("services") or [])


def require_role(*roles: str):
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "You don't have permission to do this.")
        return user
    return dependency


def require_permission(module: str, service: str | None = None):
    """FastAPI dependency factory — use as a route dependency to gate an
    endpoint behind a specific module (and optionally a specific service
    inside it), e.g. Depends(require_permission("campaigns", "delete"))."""
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        if not has_permission(user, module, service):
            raise HTTPException(403, f"You don't have access to {module}" + (f":{service}" if service else "") + ".")
        return user
    return dependency


def require_any_permission(*checks: tuple[str, str | None]):
    """Like require_permission(), but passes if ANY of the given
    (module, service) checks pass — useful when two frontend pages share one
    backend resource (e.g. the "Text to Speech" and "Manage Voices" pages
    both call the /api/tts/folders endpoints)."""
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        if not any(has_permission(user, module, service) for module, service in checks):
            names = ", ".join(f"{m}:{s}" if s else m for m, s in checks)
            raise HTTPException(403, f"You don't have access to any of: {names}.")
        return user
    return dependency


# --------------------------------------------------------------------- data
# ownership (each user's own campaigns/voices/history are private to them;
# only admin/super_admin can see everyone's)

def owner_filter(user: dict) -> dict:
    """Mongo query fragment to scope a list/find to only what this user is
    allowed to see: everything for admin/super_admin, only their own
    records for a plain user. Use as: collection.find(owner_filter(user))
    or collection.find({**owner_filter(user), "other": "condition"})."""
    if user["role"] in ("super_admin", "admin"):
        return {}
    return {"created_by": user["uid"]}


def assert_owns_or_admin(user: dict, doc: dict | None):
    """Raise 404 (not 403 — so a user can't even tell whether a given ID
    belongs to someone else) if this record isn't the caller's own and
    they're not an admin/super_admin."""
    if doc is None:
        raise HTTPException(404, "Not found")
    if user["role"] in ("super_admin", "admin"):
        return
    if doc.get("created_by") != user["uid"]:
        raise HTTPException(404, "Not found")
