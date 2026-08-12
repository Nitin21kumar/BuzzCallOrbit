import asyncio
import io
import logging
import os
import re
from datetime import datetime

import pandas as pd
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..auth import require_permission, owner_filter, assert_owns_or_admin
from ..database import (
    whatsapp_campaigns_collection, whatsapp_contacts_collection, whatsapp_messages_collection,
    whatsapp_conversations_collection, whatsapp_keyword_rules_collection, whatsapp_settings_collection,
)
from ..constants import LANGUAGE_DISPLAY, LANGUAGE_NAMES
from .. import whatsapp_client, groq_client

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp-obd"])
logger = logging.getLogger("whatsapp")

# Maps both language codes ("hi-IN") and display names ("Hindi"), case-insensitively,
# to the canonical display name — same lookup style as campaigns.py for Voice OBD,
# so the "Language" column in an uploaded sheet works identically in both modules.
_LANGUAGE_LOOKUP = {}
for _code, _name in LANGUAGE_DISPLAY.items():
    _LANGUAGE_LOOKUP[_code.lower()] = _name
    _LANGUAGE_LOOKUP[_name.lower()] = _name
_NAME_TO_CODE = {name: code for code, name in LANGUAGE_DISPLAY.items()}


def _oid(campaign_id: str) -> ObjectId:
    try:
        return ObjectId(campaign_id)
    except InvalidId:
        raise HTTPException(400, "Invalid campaign id")


def _get_settings() -> dict:
    doc = whatsapp_settings_collection.find_one({"_id": "global"}) or {}
    return {"knowledge_base": doc.get("knowledge_base", "")}


def _touch_conversation(phone_number: str, last_message: str, last_direction: str, new_status: str = None, handoff: bool = None):
    """Upserts the conversation-level doc (separate from the message log)
    so the inbox can show status/handoff without re-aggregating every
    message on every request."""
    existing = whatsapp_conversations_collection.find_one({"phone_number": phone_number}) or {}
    doc = {
        "phone_number": phone_number,
        "last_message": last_message,
        "last_direction": last_direction,
        "last_timestamp": datetime.utcnow(),
        "status": new_status if new_status is not None else existing.get("status", "open"),
        "handoff": handoff if handoff is not None else existing.get("handoff", False),
    }
    whatsapp_conversations_collection.update_one({"phone_number": phone_number}, {"$set": doc}, upsert=True)


def _serialize_campaign(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "name": doc["name"],
        "template_name": doc.get("template_name"),
        "template_language": doc.get("template_language", "en"),
        "message_text": doc.get("message_text", ""),
        "source_language_code": doc.get("source_language_code", "en-IN"),
        "campaign_context": doc.get("campaign_context", ""),
        "status": doc.get("status", "draft"),
        "created_at": doc.get("created_at"),
    }


# ---------------------------------------------------------------- schemas --

class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    template_name: str = Field(description="Exact name of an already Meta-approved WhatsApp template. For this per-contact-language flow, the template body should be just one placeholder, e.g. '{{1}}' — the translated message is sent as that variable.")
    template_language: str = Field(default="en", description="The TEMPLATE's own approved language code in Meta (e.g. 'en') — NOT the contact's language. Meta doesn't validate variable content against this, so one approved template can carry any translated language inside {{1}}.")
    message_text: str = Field(default="", description="Type your message once, in source_language_code — it gets auto-translated per contact based on their sheet's Language column")
    source_language_code: str = Field(default="en-IN", description="Language message_text is written in, e.g. 'hi-IN', 'en-IN'")
    campaign_context: str = Field(default="", description="Short description of what this campaign/number is for — used to keep the AI auto-reply on-topic")


# ---------------------------------------------------------------- templates --

class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120, description="Lowercase, underscores only, e.g. 'order_update' — auto-normalized")
    category: str = Field(default="MARKETING", description="MARKETING, UTILITY, or AUTHENTICATION")
    language_code: str = Field(default="en_US", description="Meta's template language code, e.g. 'en_US', 'hi'")
    body_example: str = Field(default="", description="Sample value for {{1}} shown to Meta's reviewers")
    static_prefix: str = Field(default="", description="Optional fixed text before {{1}} — helps Meta approve the template, since a body with ONLY a variable is sometimes rejected as spam-like")
    static_suffix: str = Field(default="", description="Optional fixed text after {{1}} (e.g. a sign-off line)")


@router.post("/templates")
def create_template(payload: TemplateCreate, user: dict = Depends(require_permission("whatsapp", "templates_create"))):
    """Creates a template with a single body placeholder '{{1}}' — the shape
    this app's per-contact-language translation flow expects. Goes to Meta
    for review; check status via GET /templates."""
    prefix = payload.static_prefix.strip()
    suffix = payload.static_suffix.strip()
    body_text = f"{prefix + chr(10) if prefix else ''}{{{{1}}}}{chr(10) + suffix if suffix else ''}"
    try:
        result = whatsapp_client.create_template(
            name=payload.name,
            category=payload.category,
            language_code=payload.language_code,
            body_text=body_text,
            body_example=payload.body_example,
        )
        return {"message": "Template submitted for review", "template_id": result.get("id"), "status": result.get("status", "PENDING")}
    except whatsapp_client.WhatsAppAPIError as exc:
        raise HTTPException(400, str(exc))


@router.get("/templates")
def get_templates(user: dict = Depends(require_permission("whatsapp", "templates_view"))):
    """Lists every template on this WhatsApp Business Account with its
    live review status, straight from Meta — so Pending/Approved/Rejected
    shows up here without needing to check WhatsApp Manager."""
    try:
        return whatsapp_client.list_templates()
    except whatsapp_client.WhatsAppAPIError as exc:
        raise HTTPException(400, str(exc))


# --------------------------------------------------------------- campaigns --

@router.post("")
def create_campaign(payload: CampaignCreate, user: dict = Depends(require_permission("whatsapp", "create"))):
    doc = {
        "name": payload.name,
        "template_name": payload.template_name,
        "template_language": payload.template_language,
        "message_text": payload.message_text,
        "source_language_code": payload.source_language_code,
        "campaign_context": payload.campaign_context,
        "status": "draft",
        "created_at": datetime.utcnow(),
        "created_by": user["uid"],
    }
    result = whatsapp_campaigns_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize_campaign(doc)


@router.get("")
def list_campaigns(user: dict = Depends(require_permission("whatsapp", "view"))):
    docs = whatsapp_campaigns_collection.find(owner_filter(user)).sort("created_at", -1)
    return [_serialize_campaign(d) for d in docs]


@router.delete("/{campaign_id}")
def delete_campaign(campaign_id: str, user: dict = Depends(require_permission("whatsapp", "delete"))):
    oid = _oid(campaign_id)
    campaign = whatsapp_campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)
    contacts_deleted = whatsapp_contacts_collection.delete_many({"campaign_id": oid}).deleted_count
    whatsapp_campaigns_collection.delete_one({"_id": oid})
    return {"message": f"Deleted campaign '{campaign['name']}' and {contacts_deleted} contact(s)"}


@router.post("/{campaign_id}/upload-contacts")
async def upload_contacts(campaign_id: str, file: UploadFile = File(...), user: dict = Depends(require_permission("whatsapp", "edit"))):
    """Contact sheet columns expected: Phone Number (required), Name (optional),
    and EITHER:
    - a Language column (e.g. "Hindi", "Bengali") — the campaign's message_text
      gets auto-translated into that contact's language before sending, OR
    - Var1, Var2, ... columns — filled directly into the template's {{1}}, {{2}}...
      placeholders as-is, no translation (use this if you're not using the
      single-message-text flow)."""
    oid = _oid(campaign_id)
    campaign = whatsapp_campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)
    if campaign.get("status", "draft") != "draft":
        raise HTTPException(400, "This campaign has already been launched — it can only be set up and started once.")

    content = await file.read()
    if file.filename.endswith((".xlsx", ".xls")):
        df = pd.read_excel(io.BytesIO(content))
    else:
        df = pd.read_csv(io.BytesIO(content))

    col_candidates = ["phone_number", "phone", "mobile", "number", "contact"]
    phone_col = next((c for c in df.columns if str(c).strip().lower() in col_candidates), None)
    if not phone_col:
        raise HTTPException(400, f"Phone number column not found. Columns found: {list(df.columns)}")
    name_col = next((c for c in df.columns if str(c).strip().lower() == "name"), None)
    language_col = next((c for c in df.columns if str(c).strip().lower() in ("language", "lang")), None)
    var_cols = sorted(
        [c for c in df.columns if re.match(r"^var\d+$", str(c).strip().lower())],
        key=lambda c: int(re.match(r"^var(\d+)$", str(c).strip().lower()).group(1)),
    )

    count = 0
    for _, row in df.iterrows():
        raw = str(row[phone_col]).strip()
        if not raw or raw.lower() == "nan":
            continue
        phone = whatsapp_client.normalize_number(raw)
        body_params = [str(row[c]) for c in var_cols] if var_cols else []

        language_value = None
        if language_col is not None:
            raw_language = str(row[language_col]).strip()
            if raw_language and raw_language.lower() != "nan":
                language_value = raw_language

        whatsapp_contacts_collection.insert_one({
            "campaign_id": oid,
            "phone_number": phone,
            "name": str(row[name_col]) if name_col else None,
            "language": language_value,
            "body_params": body_params,
            "status": "queued",
            "error_message": None,
            "wa_message_id": None,
            "sent_at": None,
        })
        count += 1

    message = f"{count} contact(s) uploaded"
    if language_col is not None:
        message += " — each will get the campaign message auto-translated into their language"
    elif not var_cols:
        message += " (no Language or Var1/Var2... column found — every contact gets the campaign message_text exactly as typed)"
    return {"message": message}


@router.delete("/{campaign_id}/contacts")
def delete_contacts(campaign_id: str, user: dict = Depends(require_permission("whatsapp", "edit"))):
    oid = _oid(campaign_id)
    campaign = whatsapp_campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)
    if campaign.get("status", "draft") != "draft":
        raise HTTPException(400, "This campaign has already been launched — it can only be set up and started once.")
    result = whatsapp_contacts_collection.delete_many({"campaign_id": oid})
    return {"message": f"Deleted {result.deleted_count} contact(s)"}


@router.post("/{campaign_id}/start")
def start_campaign(campaign_id: str, background_tasks: BackgroundTasks, user: dict = Depends(require_permission("whatsapp", "trigger"))):
    oid = _oid(campaign_id)
    campaign = whatsapp_campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)
    if campaign.get("status", "draft") != "draft":
        raise HTTPException(400, "This campaign has already been launched — it can only be started once.")

    total = whatsapp_contacts_collection.count_documents({"campaign_id": oid})
    if not total:
        raise HTTPException(400, "Upload contacts first")

    whatsapp_campaigns_collection.update_one({"_id": oid}, {"$set": {"status": "running"}})
    background_tasks.add_task(run_broadcast, campaign_id)
    return {"message": f"Campaign started — {total} WhatsApp message(s) have been queued"}


def run_broadcast(campaign_id: str):
    """Sends the approved template message to every contact, one at a time
    (Cloud API has no native bulk endpoint — each contact is a separate
    HTTP call). If the campaign has a message_text and contacts have a
    Language value, that text is translated once per unique target
    language (via Groq, cached so the same language isn't translated
    twice) and sent as the template's single body variable. Logs each
    send into whatsapp_messages_collection so it shows up in that
    contact's conversation thread from the start."""
    oid = ObjectId(campaign_id)
    campaign = whatsapp_campaigns_collection.find_one({"_id": oid})
    contacts = list(whatsapp_contacts_collection.find({"campaign_id": oid}))

    message_text = (campaign.get("message_text") or "").strip()
    source_code = campaign.get("source_language_code", "en-IN")
    source_lang_name = LANGUAGE_NAMES.get(source_code, "English")

    translation_cache: dict[str, str] = {}  # canonical display name -> translated text

    def resolve_body_params(contact: dict) -> tuple[list[str], str | None]:
        """Returns (body_params, skip_reason). skip_reason set means this
        contact should NOT be sent to (unrecognized/untranslatable language)."""
        existing = contact.get("body_params") or []
        language_value = contact.get("language")

        if not message_text:
            return existing, None  # Var-columns flow, or no text configured at all

        if not language_value:
            return [message_text], None  # no per-contact language — send as typed

        key = str(language_value).strip().lower()
        matched_name = _LANGUAGE_LOOKUP.get(key)
        if not matched_name:
            return [], f"Unrecognized language '{language_value}' — not in the supported language list"

        if matched_name not in translation_cache:
            target_code = _NAME_TO_CODE.get(matched_name, "en-IN")
            target_lang_name = LANGUAGE_NAMES.get(target_code, matched_name)
            try:
                translation_cache[matched_name] = asyncio.run(
                    groq_client.translate_text(message_text, source_lang_name, target_lang_name, gender="female")
                )
            except Exception as exc:
                return [], f"Translation to {matched_name} failed: {str(exc)[:200]}"

        return [translation_cache[matched_name]], None

    for contact in contacts:
        body_params, skip_reason = resolve_body_params(contact)
        if skip_reason:
            whatsapp_contacts_collection.update_one({"_id": contact["_id"]}, {"$set": {
                "status": "skipped", "error_message": skip_reason,
            }})
            continue
        try:
            result = whatsapp_client.send_template_message(
                to=contact["phone_number"],
                template_name=campaign["template_name"],
                language_code=campaign.get("template_language", "en"),
                body_params=body_params or None,
            )
            wa_message_id = (result.get("messages") or [{}])[0].get("id")
            whatsapp_contacts_collection.update_one({"_id": contact["_id"]}, {"$set": {
                "status": "sent", "wa_message_id": wa_message_id, "sent_at": datetime.utcnow(),
            }})
            whatsapp_messages_collection.insert_one({
                "campaign_id": oid,
                "phone_number": contact["phone_number"],
                "direction": "out",
                "text": body_params[0] if body_params else f"[Template: {campaign['template_name']}]",
                "wa_message_id": wa_message_id,
                "timestamp": datetime.utcnow(),
            })
            _touch_conversation(contact["phone_number"], body_params[0] if body_params else f"[Template: {campaign['template_name']}]", "out")
        except Exception as exc:
            whatsapp_contacts_collection.update_one({"_id": contact["_id"]}, {"$set": {
                "status": "failed", "error_message": str(exc)[:500],
            }})

    whatsapp_campaigns_collection.update_one({"_id": oid}, {"$set": {"status": "completed"}})


@router.get("/{campaign_id}/status")
def campaign_status(campaign_id: str, user: dict = Depends(require_permission("whatsapp", "view"))):
    oid = _oid(campaign_id)
    campaign = whatsapp_campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)

    contacts = list(whatsapp_contacts_collection.find({"campaign_id": oid}))
    sent = sum(1 for c in contacts if c["status"] == "sent")
    failed = sum(1 for c in contacts if c["status"] == "failed")
    queued = sum(1 for c in contacts if c["status"] == "queued")
    return {
        "total_contacts": len(contacts), "sent": sent, "failed": failed,
        "queued": queued, "campaign_status": campaign.get("status", "draft"),
    }


@router.get("/{campaign_id}/report")
def download_report(campaign_id: str, user: dict = Depends(require_permission("whatsapp", "view"))):
    oid = _oid(campaign_id)
    campaign = whatsapp_campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)
    contacts = list(whatsapp_contacts_collection.find({"campaign_id": oid}))
    data = [{
        "Phone Number": c["phone_number"],
        "Name": c.get("name") or "",
        "Language": c.get("language") or "",
        "Status": c["status"],
        "Sent At": c["sent_at"].strftime("%Y-%m-%d %H:%M:%S") if c.get("sent_at") else "",
        "Error": c.get("error_message") or "",
    } for c in contacts]
    df = pd.DataFrame(data)
    buffer = io.BytesIO()
    df.to_excel(buffer, index=False, engine="openpyxl")
    buffer.seek(0)
    return StreamingResponse(
        buffer, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=whatsapp_campaign_{campaign_id}_report.xlsx"},
    )


# ----------------------------------------------------------- conversations --

@router.get("/conversations")
def list_conversations(user: dict = Depends(require_permission("whatsapp", "inbox_view"))):
    """One row per phone number, with status/handoff/last-message preview —
    powers the inbox list. Reads from the dedicated conversations collection
    (kept in sync by _touch_conversation on every in/out message) instead of
    re-aggregating the full message log on every request."""
    docs = whatsapp_conversations_collection.find().sort("last_timestamp", -1)
    return [{
        "phone_number": d["phone_number"],
        "last_message": d.get("last_message", ""),
        "last_direction": d.get("last_direction", "in"),
        "last_timestamp": d.get("last_timestamp"),
        "status": d.get("status", "open"),
        "handoff": d.get("handoff", False),
    } for d in docs]


@router.get("/handoff-count")
def get_handoff_count(user: dict = Depends(require_permission("whatsapp", "inbox_view"))):
    """Number of conversations currently waiting on a human (handoff=true) —
    powers the notification badge in the sidebar so a paused chat isn't
    missed if the WhatsApp tab isn't open."""
    count = whatsapp_conversations_collection.count_documents({"handoff": True})
    return {"count": count}


@router.get("/conversations/{phone_number}/messages")
def get_conversation(phone_number: str, user: dict = Depends(require_permission("whatsapp", "inbox_view"))):
    docs = whatsapp_messages_collection.find({"phone_number": phone_number}).sort("timestamp", 1)
    return [{
        "direction": d["direction"], "text": d["text"], "timestamp": d["timestamp"],
    } for d in docs]


class ManualMessageSend(BaseModel):
    text: str = Field(min_length=1, max_length=4096)


@router.post("/conversations/{phone_number}/send")
def send_manual_message(phone_number: str, payload: ManualMessageSend, user: dict = Depends(require_permission("whatsapp", "inbox_reply"))):
    """Lets a human agent reply directly from the dashboard - used when a
    chat is in handoff (AI paused) so the conversation doesn't just sit
    silent waiting for someone to notice. Only works inside WhatsApp's 24h
    session window, same as the AI's replies."""
    try:
        result = whatsapp_client.send_text_message(phone_number, payload.text)
    except whatsapp_client.WhatsAppAPIError as exc:
        raise HTTPException(400, str(exc))
    wa_message_id = (result.get("messages") or [{}])[0].get("id")
    whatsapp_messages_collection.insert_one({
        "campaign_id": None, "phone_number": phone_number, "direction": "out",
        "text": payload.text, "wa_message_id": wa_message_id, "timestamp": datetime.utcnow(),
    })
    _touch_conversation(phone_number, payload.text, "out")
    return {"message": "Sent"}


class ConversationStatusUpdate(BaseModel):
    status: str = Field(description="'open', 'pending', or 'resolved'")


@router.patch("/conversations/{phone_number}/status")
def set_conversation_status(phone_number: str, payload: ConversationStatusUpdate, user: dict = Depends(require_permission("whatsapp", "inbox_reply"))):
    if payload.status not in ("open", "pending", "resolved"):
        raise HTTPException(400, "status must be 'open', 'pending', or 'resolved'")
    whatsapp_conversations_collection.update_one({"phone_number": phone_number}, {"$set": {"status": payload.status}}, upsert=True)
    return {"message": f"Status set to {payload.status}"}


class ConversationHandoffUpdate(BaseModel):
    handoff: bool = Field(description="true = pause AI auto-reply (human is handling this chat); false = resume AI")


@router.patch("/conversations/{phone_number}/handoff")
def set_conversation_handoff(phone_number: str, payload: ConversationHandoffUpdate, user: dict = Depends(require_permission("whatsapp", "inbox_reply"))):
    """Manually pause/resume the AI for one conversation — used both by an
    agent taking over a chat, and to resume AI after handling it."""
    new_status = "pending" if payload.handoff else "open"
    whatsapp_conversations_collection.update_one(
        {"phone_number": phone_number}, {"$set": {"handoff": payload.handoff, "status": new_status}}, upsert=True,
    )
    return {"message": "AI paused — you're handling this chat" if payload.handoff else "AI resumed for this chat"}


# --------------------------------------------------------------- keyword rules --

class KeywordRuleCreate(BaseModel):
    keyword: str = Field(min_length=1, max_length=200)
    reply_text: str = Field(min_length=1, max_length=4096)
    match_type: str = Field(default="contains", description="'contains' or 'exact'")


@router.get("/keyword-rules")
def list_keyword_rules(user: dict = Depends(require_permission("whatsapp", "settings_view"))):
    docs = whatsapp_keyword_rules_collection.find().sort("created_at", -1)
    return [{
        "id": str(d["_id"]), "keyword": d["keyword"], "reply_text": d["reply_text"],
        "match_type": d.get("match_type", "contains"), "active": d.get("active", True),
    } for d in docs]


@router.post("/keyword-rules")
def create_keyword_rule(payload: KeywordRuleCreate, user: dict = Depends(require_permission("whatsapp", "settings_edit"))):
    doc = {
        "keyword": payload.keyword.strip(), "reply_text": payload.reply_text.strip(),
        "match_type": payload.match_type if payload.match_type in ("contains", "exact") else "contains",
        "active": True, "created_at": datetime.utcnow(),
    }
    result = whatsapp_keyword_rules_collection.insert_one(doc)
    return {"id": str(result.inserted_id), "message": "Rule created"}


@router.delete("/keyword-rules/{rule_id}")
def delete_keyword_rule(rule_id: str, user: dict = Depends(require_permission("whatsapp", "settings_edit"))):
    try:
        oid = ObjectId(rule_id)
    except InvalidId:
        raise HTTPException(400, "Invalid rule id")
    whatsapp_keyword_rules_collection.delete_one({"_id": oid})
    return {"message": "Rule deleted"}


# ------------------------------------------------------------- AI settings --

class SettingsUpdate(BaseModel):
    knowledge_base: str = Field(default="", max_length=20000, description="FAQ/policy text the AI auto-reply is grounded on")


@router.get("/settings")
def get_ai_settings(user: dict = Depends(require_permission("whatsapp", "settings_view"))):
    return _get_settings()


@router.put("/settings")
def update_ai_settings(payload: SettingsUpdate, user: dict = Depends(require_permission("whatsapp", "settings_edit"))):
    whatsapp_settings_collection.update_one(
        {"_id": "global"}, {"$set": {"knowledge_base": payload.knowledge_base.strip()}}, upsert=True,
    )
    return {"message": "Settings saved"}


# --------------------------------------------------------------- webhook ---
# Meta requires ONE webhook URL for the whole WhatsApp app (set it in
# Meta App Dashboard > WhatsApp > Configuration):
#   https://<your PUBLIC_BASE_URL>/api/whatsapp/webhooks/incoming
# GET is Meta's one-time "verify this URL" handshake; POST is every
# subsequent event (incoming messages + delivery/read status updates).

@router.get("/webhooks/incoming")
def verify_webhook(request: Request):
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge", "")
    expected_token = os.getenv("WHATSAPP_VERIFY_TOKEN", "")

    if mode == "subscribe" and token == expected_token and expected_token:
        return PlainTextResponse(challenge)
    raise HTTPException(403, "Webhook verification failed — check WHATSAPP_VERIFY_TOKEN in .env matches what you entered in Meta App Dashboard")


@router.post("/webhooks/incoming")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    payload = await request.json()
    logger.info("WhatsApp webhook received: %s", payload)

    try:
        entry = payload["entry"][0]
        change = entry["changes"][0]["value"]
    except (KeyError, IndexError):
        return {"ok": True}  # nothing to process (e.g. an event shape we don't use)

    # Delivery/read status update for a message we sent (template or reply)
    for status in change.get("statuses", []):
        whatsapp_contacts_collection.update_many(
            {"wa_message_id": status.get("id")},
            {"$set": {"status": status.get("status", "sent")}},
        )

    # Incoming user message — this is the "interaction" part
    for msg in change.get("messages", []):
        phone_number = msg.get("from")
        wa_message_id = msg.get("id")

        # Plain text, or a tap on a quick-reply button we sent earlier
        text = (msg.get("text") or {}).get("body", "")
        if msg.get("type") == "interactive":
            interactive = msg.get("interactive", {})
            if interactive.get("type") == "button_reply":
                text = interactive["button_reply"].get("title", "")

        if not phone_number or not text:
            continue  # skip non-text, non-button message types (image/audio/etc.) for now

        whatsapp_messages_collection.insert_one({
            "campaign_id": None,
            "phone_number": phone_number,
            "direction": "in",
            "text": text,
            "wa_message_id": wa_message_id,
            "timestamp": datetime.utcnow(),
        })

        existing_conv = whatsapp_conversations_collection.find_one({"phone_number": phone_number})
        is_handed_off = bool(existing_conv and existing_conv.get("handoff"))
        _touch_conversation(phone_number, text, "in", new_status=("pending" if is_handed_off else "open"))

        if not is_handed_off:
            background_tasks.add_task(auto_reply, phone_number, text)
        # else: a human already took over this chat — AI stays silent until handoff is turned off

    return {"ok": True}


def auto_reply(phone_number: str, incoming_text: str):
    """Runs after the webhook responds (so Meta doesn't time out waiting on
    Groq). Order of checks:
    1. Keyword rules — instant fixed reply, no AI call, if the message
       matches an active rule (cheap, deterministic, good for FAQs).
    2. Groq AI — grounded on the business knowledge base + this
       conversation's campaign context, returns a reply plus optional
       quick-reply buttons and a human-handoff flag."""
    # 1. Keyword rules
    rules = list(whatsapp_keyword_rules_collection.find({"active": True}))
    text_lower = incoming_text.strip().lower()
    for rule in rules:
        kw = rule["keyword"].strip().lower()
        matched = (text_lower == kw) if rule.get("match_type") == "exact" else (kw in text_lower)
        if matched:
            try:
                reply_text = rule["reply_text"]
                result = whatsapp_client.send_text_message(phone_number, reply_text)
                wa_message_id = (result.get("messages") or [{}])[0].get("id")
                whatsapp_messages_collection.insert_one({
                    "campaign_id": None, "phone_number": phone_number, "direction": "out",
                    "text": reply_text, "wa_message_id": wa_message_id, "timestamp": datetime.utcnow(),
                })
                _touch_conversation(phone_number, reply_text, "out")
            except Exception as exc:
                logger.error("Keyword-rule reply failed for %s: %s", phone_number, exc)
            return  # matched a rule — skip the AI entirely for this message

    # 2. AI reply
    history_docs = list(
        whatsapp_messages_collection.find({"phone_number": phone_number}).sort("timestamp", -1).limit(10)
    )
    history_docs.reverse()
    history = [{"direction": d["direction"], "text": d["text"]} for d in history_docs]

    # Pull campaign_context from whichever campaign last messaged this number, if any.
    last_campaign_msg = whatsapp_messages_collection.find_one(
        {"phone_number": phone_number, "campaign_id": {"$ne": None}}, sort=[("timestamp", -1)]
    )
    context = ""
    if last_campaign_msg and last_campaign_msg.get("campaign_id"):
        campaign = whatsapp_campaigns_collection.find_one({"_id": last_campaign_msg["campaign_id"]})
        context = (campaign or {}).get("campaign_context", "")
    knowledge_base = _get_settings()["knowledge_base"]

    try:
        result = asyncio.run(groq_client.whatsapp_smart_reply(incoming_text, history, context, knowledge_base))
        reply_text = result["reply"]
        buttons = result["buttons"]
        needs_human = result["needs_human"]

        if buttons and not needs_human:
            send_result = whatsapp_client.send_interactive_buttons(
                phone_number, reply_text, [{"id": f"btn_{i}", "title": b} for i, b in enumerate(buttons)]
            )
            logged_text = f"{reply_text} [{' / '.join(buttons)}]"
        else:
            send_result = whatsapp_client.send_text_message(phone_number, reply_text)
            logged_text = reply_text

        wa_message_id = (send_result.get("messages") or [{}])[0].get("id")
        whatsapp_messages_collection.insert_one({
            "campaign_id": None, "phone_number": phone_number, "direction": "out",
            "text": logged_text, "wa_message_id": wa_message_id, "timestamp": datetime.utcnow(),
        })

        if needs_human:
            _touch_conversation(phone_number, logged_text, "out", new_status="pending", handoff=True)
        else:
            _touch_conversation(phone_number, logged_text, "out")
    except Exception as exc:
        logger.error("Auto-reply failed for %s: %s", phone_number, exc)
