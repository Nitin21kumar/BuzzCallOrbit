import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import auth as firebase_auth
from pydantic import BaseModel, EmailStr, Field

from ..auth import get_current_user, require_permission
from ..database import users_collection
from ..firebase_admin_client import get_firebase_app
from ..permissions import ASSIGNABLE_ROLES, MODULE_CATALOG, catalog_response, default_permissions_for_role

router = APIRouter(prefix="/api/users", tags=["users"])


def _public(profile: dict) -> dict:
    return {
        "uid": profile["uid"],
        "email": profile["email"],
        "name": profile.get("name", ""),
        "role": profile["role"],
        "modules": profile.get("modules", []),
        "services": profile.get("services", []),
        "fields": profile.get("fields", []),
        "active": profile.get("active", True),
        "created_at": profile.get("created_at"),
    }


def _assert_valid_grants(modules: list[str], services: list[str], fields: list[str]):
    for m in modules:
        if m not in MODULE_CATALOG:
            raise HTTPException(422, f"Unknown module '{m}'")
    for s in services:
        mod = s.split(":")[0]
        if mod not in MODULE_CATALOG or s.split(":", 1)[1] not in MODULE_CATALOG[mod]["services"]:
            raise HTTPException(422, f"Unknown service '{s}'")
    for f in fields:
        mod = f.split(":")[0]
        if mod not in MODULE_CATALOG or f.split(":", 1)[1] not in MODULE_CATALOG[mod]["fields"]:
            raise HTTPException(422, f"Unknown field '{f}'")


def _assert_can_assign_role(actor: dict, target_role: str):
    if target_role not in ASSIGNABLE_ROLES.get(actor["role"], []):
        raise HTTPException(403, f"Your role ({actor['role']}) can't assign the '{target_role}' role.")


def _assert_can_manage(actor: dict, target_profile: dict):
    """super_admin can manage admins & users; admin can only manage users;
    nobody can manage themselves through this endpoint (use /me), and nobody
    can manage a peer/superior role."""
    if target_profile["uid"] == actor["uid"]:
        raise HTTPException(400, "Use your own profile settings to change your own account.")
    if target_profile["role"] not in ASSIGNABLE_ROLES.get(actor["role"], []):
        raise HTTPException(403, "You don't have permission to manage this user.")


# --------------------------------------------------------------------- me --

@router.get("/me")
def get_me(user: dict = Depends(get_current_user)):
    return {"profile": _public(user), "catalog": catalog_response()}


# ------------------------------------------------------------------ catalog

@router.get("/catalog")
def get_catalog(user: dict = Depends(require_permission("users", "view"))):
    return catalog_response()


# --------------------------------------------------------------------- CRUD

@router.get("")
def list_users(user: dict = Depends(require_permission("users", "view"))):
    manageable_roles = ASSIGNABLE_ROLES.get(user["role"], []) + [user["role"]]
    docs = list(users_collection.find({"role": {"$in": manageable_roles}}).sort("created_at", -1))
    return [_public(d) for d in docs]


class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="user")
    modules: list[str] = Field(default_factory=list)
    services: list[str] = Field(default_factory=list)
    fields: list[str] = Field(default_factory=list)


@router.post("")
def create_user(payload: UserCreate, actor: dict = Depends(require_permission("users", "create"))):
    _assert_can_assign_role(actor, payload.role)
    _assert_valid_grants(payload.modules, payload.services, payload.fields)

    try:
        get_firebase_app()
    except RuntimeError as e:
        raise HTTPException(503, str(e))

    temp_password = secrets.token_urlsafe(12)
    try:
        fb_user = firebase_auth.create_user(email=payload.email, password=temp_password, display_name=payload.name)
    except firebase_auth.EmailAlreadyExistsError:
        raise HTTPException(409, "A user with this email already exists.")

    profile = {
        "uid": fb_user.uid,
        "email": payload.email,
        "name": payload.name,
        "role": payload.role,
        "modules": payload.modules,
        "services": payload.services,
        "fields": payload.fields,
        "active": True,
        "created_by": actor["uid"],
        "created_at": datetime.now(timezone.utc),
    }
    users_collection.insert_one(profile)

    # No email-sending infra in this app yet, so hand back a one-time reset
    # link the admin can share with the new user however they like.
    reset_link = None
    try:
        reset_link = firebase_auth.generate_password_reset_link(payload.email)
    except Exception:
        pass

    return {"user": _public(profile), "password_reset_link": reset_link}


class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    modules: list[str] | None = None
    services: list[str] | None = None
    fields: list[str] | None = None
    active: bool | None = None


@router.patch("/{uid}")
def update_user(uid: str, payload: UserUpdate, actor: dict = Depends(require_permission("users", "edit"))):
    target = users_collection.find_one({"uid": uid})
    if not target:
        raise HTTPException(404, "User not found")
    _assert_can_manage(actor, target)

    updates = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.role is not None:
        _assert_can_assign_role(actor, payload.role)
        updates["role"] = payload.role
    if payload.modules is not None or payload.services is not None or payload.fields is not None:
        modules = payload.modules if payload.modules is not None else target.get("modules", [])
        services = payload.services if payload.services is not None else target.get("services", [])
        fields = payload.fields if payload.fields is not None else target.get("fields", [])
        _assert_valid_grants(modules, services, fields)
        updates["modules"], updates["services"], updates["fields"] = modules, services, fields
    if payload.active is not None:
        updates["active"] = payload.active
        try:
            get_firebase_app()
            firebase_auth.update_user(uid, disabled=not payload.active)
        except RuntimeError:
            pass

    if updates:
        users_collection.update_one({"uid": uid}, {"$set": updates})
    updated = users_collection.find_one({"uid": uid})
    return _public(updated)


@router.delete("/{uid}")
def delete_user(uid: str, actor: dict = Depends(require_permission("users", "delete"))):
    target = users_collection.find_one({"uid": uid})
    if not target:
        raise HTTPException(404, "User not found")
    _assert_can_manage(actor, target)

    users_collection.delete_one({"uid": uid})
    try:
        get_firebase_app()
        firebase_auth.delete_user(uid)
    except Exception:
        pass  # Mongo profile is gone either way; Firebase-side cleanup is best-effort
    return {"deleted": True}
