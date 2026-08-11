"""
WhatsApp integration - Meta WhatsApp Cloud API (direct, no BSP middleman).

Setup checklist (do this in Meta for Developers, developers.facebook.com):
1. Create a Meta App -> add the "WhatsApp" product.
2. From WhatsApp > API Setup you get a **temporary** access token, a
   **Phone Number ID**, and a **WhatsApp Business Account ID (WABA ID)**.
   The temporary token expires in 24h - for anything beyond quick testing,
   generate a **permanent** token: create a System User in Meta Business
   Settings, assign it the WhatsApp app with `whatsapp_business_messaging`
   + `whatsapp_business_management` permissions, generate its token there.
3. Create message templates under WhatsApp Manager > Message Templates.
   Every template needs Meta's approval (usually minutes to ~24h) before
   it can be used for OBD (first-contact) messages - see README for why.
4. Set up the webhook (see routers/whatsapp.py) so Meta can push incoming
   replies and delivery/read status updates to this backend. Meta requires
   a public HTTPS URL for this - same ngrok trick already used for Sarv.

Two message-sending modes, same as any WhatsApp Business API:
- **Template message** (`send_template_message`): the ONLY way to message
  someone who hasn't messaged you in the last 24h - i.e. this is what OBD
  broadcasts use. Must reference an already-approved template.
- **Free-form text** (`send_text_message`): only works inside the 24-hour
  "customer service window" that opens the moment a user replies to you.
  This is what the AI auto-reply uses to answer their message.

Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
"""

import os
import re
from typing import Optional

import httpx

GRAPH_VERSION = os.getenv("WHATSAPP_API_VERSION", "v21.0")
GRAPH_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"


class WhatsAppAPIError(RuntimeError):
    pass


def _config():
    return {
        "phone_number_id": os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip(),
        "access_token": os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip(),
        "waba_id": os.getenv("WHATSAPP_BUSINESS_ACCOUNT_ID", "").strip(),
    }


def _require_config(cfg: dict):
    missing = [k for k in ("phone_number_id", "access_token") if not cfg[k]]
    if missing:
        raise WhatsAppAPIError(
            f"WhatsApp credentials not configured (missing: {', '.join(missing)}). "
            "Check WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN in backend/.env"
        )


def normalize_number(phone_number: str) -> str:
    """WhatsApp Cloud API wants full international-format digits, no '+', no spaces.
    Assumes Indian 10-digit numbers if no country code is present."""
    digits = "".join(ch for ch in phone_number if ch.isdigit())
    if len(digits) == 10:
        digits = "91" + digits
    return digits


def _post(payload: dict) -> dict:
    cfg = _config()
    _require_config(cfg)
    url = f"{GRAPH_BASE}/{cfg['phone_number_id']}/messages"
    headers = {
        "Authorization": f"Bearer {cfg['access_token']}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=30) as client:
        resp = client.post(url, headers=headers, json=payload)
    try:
        data = resp.json()
    except ValueError:
        raise WhatsAppAPIError(f"WhatsApp API returned non-JSON response: {resp.text[:300]}")
    if resp.is_error:
        err = data.get("error", {})
        raise WhatsAppAPIError(err.get("message") or f"WhatsApp API error ({resp.status_code}): {data}")
    return data


def send_template_message(
    to: str,
    template_name: str,
    language_code: str = "en",
    body_params: Optional[list[str]] = None,
) -> dict:
    """Sends an approved template message - use this for OBD broadcasts
    (first contact / outside the 24h window). `body_params` fills the
    template's {{1}}, {{2}}... placeholders, in order, if it has any."""
    to = normalize_number(to)
    components = []
    if body_params:
        components.append({
            "type": "body",
            "parameters": [{"type": "text", "text": str(p)} for p in body_params],
        })

    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": language_code},
            **({"components": components} if components else {}),
        },
    }
    return _post(payload)


def send_text_message(to: str, body: str) -> dict:
    """Sends a free-form text reply - only works within 24h of the user's
    last incoming message. Use this for the AI auto-reply."""
    to = normalize_number(to)
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"preview_url": False, "body": body},
    }
    return _post(payload)


def send_interactive_buttons(to: str, body_text: str, buttons: list[dict]) -> dict:
    """Sends up to 3 tappable quick-reply buttons alongside body_text -
    only works within the 24h session window, same as send_text_message.
    `buttons` is a list of {"id": str, "title": str}; title is capped at
    20 chars by WhatsApp - longer titles are truncated here."""
    to = normalize_number(to)
    action_buttons = [
        {"type": "reply", "reply": {"id": str(b["id"])[:256], "title": str(b["title"])[:20]}}
        for b in buttons[:3]
    ]
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "button",
            "body": {"text": body_text},
            "action": {"buttons": action_buttons},
        },
    }
    return _post(payload)


def mark_as_read(message_id: str) -> dict:
    """Optional but good UX - shows blue double-ticks to the user."""
    payload = {
        "messaging_product": "whatsapp",
        "status": "read",
        "message_id": message_id,
    }
    return _post(payload)


# --------------------------------------------------------- template management --
# These manage the templates themselves (create/list/delete) via the WhatsApp
# Business Account (WABA), as opposed to _post() above which sends messages
# via the phone number. Needs WHATSAPP_BUSINESS_ACCOUNT_ID in .env (the
# "WhatsApp Business Account ID" shown next to Phone Number ID on Meta's
# API Setup page).

def _require_waba_config(cfg: dict):
    missing = [k for k in ("waba_id", "access_token") if not cfg[k]]
    if missing:
        raise WhatsAppAPIError(
            f"WhatsApp Business Account credentials not configured (missing: {', '.join(missing)}). "
            "Check WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_ACCESS_TOKEN in backend/.env"
        )


def create_template(name: str, category: str, language_code: str, body_text: str, body_example: str) -> dict:
    """Creates a new message template for review, with a single BODY
    component. `body_text` should contain the {{1}}, {{2}}... placeholders
    you want (this app's per-contact-language flow expects exactly one:
    "{{1}}"). `body_example` is a sample value Meta shows reviewers for
    the LAST placeholder present - required by the API for any template
    that has variables. `name` must be lowercase with underscores only,
    and category should be 'MARKETING', 'UTILITY', or 'AUTHENTICATION'."""
    cfg = _config()
    _require_waba_config(cfg)

    components = [{"type": "BODY", "text": body_text}]
    if "{{1}}" in body_text or re.search(r"\{\{\d+\}\}", body_text):
        components[0]["example"] = {"body_text": [[body_example or "Sample text"]]}

    payload = {
        "name": name.strip().lower().replace(" ", "_"),
        "language": language_code,
        "category": category.upper(),
        "components": components,
    }
    url = f"{GRAPH_BASE}/{cfg['waba_id']}/message_templates"
    headers = {
        "Authorization": f"Bearer {cfg['access_token']}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=30) as client:
        resp = client.post(url, headers=headers, json=payload)
    try:
        data = resp.json()
    except ValueError:
        raise WhatsAppAPIError(f"WhatsApp API returned non-JSON response: {resp.text[:300]}")
    if resp.is_error:
        err = data.get("error", {})
        detail = err.get("error_user_msg") or err.get("message") or f"WhatsApp API error ({resp.status_code}): {data}"
        if err.get("error_user_title"):
            detail = f"{err['error_user_title']}: {detail}"
        raise WhatsAppAPIError(detail)
    return data


def list_templates() -> list[dict]:
    """Fetches every template on this WABA with its current review status -
    used so the dashboard can show Pending/Approved/Rejected without the
    user needing to check WhatsApp Manager separately."""
    cfg = _config()
    _require_waba_config(cfg)

    url = f"{GRAPH_BASE}/{cfg['waba_id']}/message_templates"
    params = {"fields": "name,status,category,language,rejected_reason", "limit": 100}
    headers = {"Authorization": f"Bearer {cfg['access_token']}"}
    with httpx.Client(timeout=30) as client:
        resp = client.get(url, headers=headers, params=params)
    try:
        data = resp.json()
    except ValueError:
        raise WhatsAppAPIError(f"WhatsApp API returned non-JSON response: {resp.text[:300]}")
    if resp.is_error:
        err = data.get("error", {})
        raise WhatsAppAPIError(err.get("message") or f"WhatsApp API error ({resp.status_code}): {data}")
    return data.get("data", [])
