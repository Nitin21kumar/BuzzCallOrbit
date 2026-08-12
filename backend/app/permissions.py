"""
Central catalog of everything a role/user can be granted access to, in three
levels — matching how the product asked for it:

    module   -> a whole section of the app, e.g. "campaigns"
      service  -> a specific action inside that module, e.g. "campaigns:delete"
      field    -> a specific data field inside that module a user may or may
                  not see/edit, e.g. the "budget" column on a campaign

This is the single source of truth: the admin panel renders its
module/service/field checkboxes straight from this dict, and every protected
API route checks against it (see app/auth.py). Add a new module/service/field
here and it's immediately assignable and enforceable — no other change needed
unless you also want a specific endpoint to *enforce* the new item (see the
require_permission() calls in the routers).
"""

MODULE_CATALOG = {
    "dashboard": {
        "label": "Dashboard",
        "services": {
            "view": "View dashboard & analytics",
        },
        "fields": [],
    },
    "tts": {
        "label": "Text to Speech",
        "services": {
            "view": "View voice folders",
            "generate": "Generate new audio",
            "delete": "Delete generated audio",
        },
        "fields": ["text", "speaker", "pace", "temperature"],
    },
    "stt": {
        "label": "Speech to Text",
        "services": {
            "view": "View transcription history",
            "transcribe": "Transcribe audio",
        },
        "fields": [],
    },
    "voices": {
        "label": "Manage Voices",
        "services": {
            "view": "View voice folders",
            "create": "Create voice folders",
            "delete": "Delete voice folders",
        },
        "fields": [],
    },
    "campaigns": {
        "label": "Campaigns",
        "services": {
            "view": "View campaigns",
            "create": "Create campaigns",
            "edit": "Edit campaigns",
            "delete": "Delete campaigns",
            "trigger": "Start / stop calling",
        },
        "fields": ["budget", "script", "contact_list", "schedule"],
    },
    "whatsapp": {
        "label": "WhatsApp",
        "services": {
            "view": "View campaigns & reports",
            "create": "Create campaigns",
            "edit": "Upload / clear contacts",
            "delete": "Delete campaigns",
            "trigger": "Start broadcast",
            "templates_view": "View message templates",
            "templates_create": "Create message templates",
            "inbox_view": "View conversations",
            "inbox_reply": "Reply to conversations / set status / handoff",
            "settings_view": "View AI knowledge base & keyword rules",
            "settings_edit": "Manage AI knowledge base & keyword rules",
        },
        "fields": [],
    },
    "users": {
        "label": "User Management",
        "services": {
            "view": "View users",
            "create": "Create users",
            "edit": "Edit users & permissions",
            "delete": "Deactivate / delete users",
        },
        "fields": [],
    },
}

ROLES = ["super_admin", "admin", "user"]

# What a role is allowed to *assign* to someone else, i.e. the hierarchy.
# super_admin can create/manage admins and users; admin can only manage users.
ASSIGNABLE_ROLES = {
    "super_admin": ["super_admin", "admin", "user"],
    "admin": ["user"],
    "user": [],
}


def default_permissions_for_role(role: str) -> dict:
    """super_admin/admin implicitly get every module+service (see auth.py's
    has_permission, which short-circuits for these two roles).

    A brand-new plain "user" — the very first time they sign in — can browse
    every page (see what each feature/module offers, its forms and options)
    EXCEPT User Management, which stays admin-only by default. They start
    with NO services granted at all — not even "view" — so they can't see
    any existing data/history/lists, and obviously can't create, edit,
    delete, or trigger anything either, until an admin explicitly grants
    those specific permissions from User Management. This is only a
    starting point; an admin can tighten it further (remove a module
    entirely) or loosen it (grant specific view/action permissions) at any
    time."""
    if role in ("super_admin", "admin"):
        return {"modules": list(MODULE_CATALOG.keys()), "services": _all_services(), "fields": _all_fields()}
    return {
        "modules": [m for m in MODULE_CATALOG if m != "users"],
        "services": [],
        "fields": [],
    }


def _all_services() -> list[str]:
    out = []
    for mod, cfg in MODULE_CATALOG.items():
        for svc in cfg["services"]:
            out.append(f"{mod}:{svc}")
    return out


def _all_fields() -> list[str]:
    out = []
    for mod, cfg in MODULE_CATALOG.items():
        for f in cfg["fields"]:
            out.append(f"{mod}:{f}")
    return out


def catalog_response() -> dict:
    """Shape the catalog for the frontend admin panel."""
    return {
        "roles": ROLES,
        "assignable_roles": ASSIGNABLE_ROLES,
        "modules": [
            {
                "key": key,
                "label": cfg["label"],
                "services": [{"key": f"{key}:{s}", "label": label} for s, label in cfg["services"].items()],
                "fields": [{"key": f"{key}:{f}", "label": f} for f in cfg["fields"]],
            }
            for key, cfg in MODULE_CATALOG.items()
        ],
    }
