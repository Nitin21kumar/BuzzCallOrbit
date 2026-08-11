import io
import os
import re
import time
from datetime import datetime, timedelta
from urllib.parse import quote

import pandas as pd
from bson import ObjectId, Binary
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth import require_permission, owner_filter, assert_owns_or_admin
from ..database import campaigns_collection, contacts_collection, call_logs_collection, voice_folders_collection, tts_collection, check_connection
from ..constants import LANGUAGE_DISPLAY
from .. import sarv_client

router = APIRouter(tags=["obd-campaigns"])

# Maps both language codes ("hi-IN") and display names ("Hindi"), case-insensitively,
# to the canonical display name used to build the saved filename (e.g. "hindi.mp3").
_LANGUAGE_LOOKUP = {}
for _code, _name in LANGUAGE_DISPLAY.items():
    _LANGUAGE_LOOKUP[_code.lower()] = _name
    _LANGUAGE_LOOKUP[_name.lower()] = _name


def _resolve_language_audio(language_value: str | None, voice_folder_id: str | None):
    """Given a raw language string from the contact sheet (e.g. 'Hindi', 'hi-IN',
    or messy casing), find the matching saved TTS recording *within the
    selected voice folder*, by querying MongoDB directly (the audio itself
    lives inside that same tts_audio document - no filesystem involved).
    Returns (audio_ref, error) - exactly one of which is set. audio_ref is a
    dict describing how to fetch this recording in real time later."""
    if not language_value or not str(language_value).strip():
        return None, "No language specified for this contact"

    if not voice_folder_id:
        return None, "No voice folder has been selected for this campaign"

    key = str(language_value).strip().lower()
    matched_name = _LANGUAGE_LOOKUP.get(key)
    if not matched_name:
        return None, f"File name mismatch with details — '{language_value}' is not a recognized language"

    filename = f"{matched_name.lower()}.mp3"
    doc = tts_collection.find_one({"folder_id": voice_folder_id, "filename": filename}, {"_id": 1})
    if not doc:
        return None, f"File name mismatch with details — no saved recording found for '{matched_name}' in the selected voice folder ({filename})"

    return {"type": "tts", "folder_id": voice_folder_id, "filename": filename}, None


def _oid(campaign_id: str) -> ObjectId:
    try:
        return ObjectId(campaign_id)
    except InvalidId:
        raise HTTPException(400, "Invalid campaign id")


def _serialize_campaign(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "name": doc["name"],
        "status": doc.get("status", "draft"),
        "audio_filename": doc.get("audio_filename"),
        "has_default_audio": bool(doc.get("audio_data")),
        "voice_source_folder_id": doc.get("voice_source_folder_id"),
        "created_at": doc.get("created_at"),
    }


# ---------------------------------------------------------------- schemas --

class CampaignCreate(BaseModel):
    name: str


class VoiceSourceUpdate(BaseModel):
    voice_source_folder_id: str


# --------------------------------------------------------------- campaigns --

@router.post("/api/campaigns")
def create_campaign(payload: CampaignCreate, user: dict = Depends(require_permission("campaigns", "create"))):
    doc = {"name": payload.name, "status": "draft", "audio_filename": None, "voice_source_folder_id": None, "created_at": datetime.utcnow(), "created_by": user["uid"]}
    result = campaigns_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize_campaign(doc)


@router.get("/api/campaigns")
def list_campaigns(user: dict = Depends(require_permission("campaigns", "view"))):
    docs = campaigns_collection.find(owner_filter(user), {"audio_data": 0}).sort("created_at", -1)
    return [_serialize_campaign(d) for d in docs]


@router.patch("/api/campaigns/{campaign_id}/voice-source")
def set_voice_source(campaign_id: str, payload: VoiceSourceUpdate, user: dict = Depends(require_permission("campaigns", "edit"))):
    """Choose which voice folder (created in the Text-to-Speech Studio) this
    calling campaign should pull recordings from when matching each contact's language."""
    oid = _oid(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)
    if campaign.get("status", "draft") != "draft":
        raise HTTPException(400, "This campaign has already been launched — it can only be set up and started once.")
    try:
        folder_oid = ObjectId(payload.voice_source_folder_id)
    except InvalidId:
        raise HTTPException(400, "Invalid voice folder id")
    folder = voice_folders_collection.find_one({"_id": folder_oid})
    if not folder:
        raise HTTPException(404, "Selected voice folder not found")

    campaigns_collection.update_one({"_id": oid}, {"$set": {"voice_source_folder_id": payload.voice_source_folder_id}})
    return {"message": f"This campaign will now use voices from the folder '{folder['name']}'"}


@router.get("/api/campaigns/{campaign_id}/audio")
def get_campaign_audio(campaign_id: str, user: dict = Depends(require_permission("campaigns", "view"))):
    """Streams this campaign's default audio straight out of MongoDB in real
    time - nothing is ever read from local disk. Used both by Twilio's
    <Play> during a live call and for in-app preview/download."""
    oid = _oid(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid}, {"audio_data": 1, "audio_content_type": 1, "audio_filename": 1, "created_by": 1})
    if not campaign or not campaign.get("audio_data"):
        raise HTTPException(404, "No default audio uploaded for this campaign")
    assert_owns_or_admin(user, campaign)
    return Response(
        content=bytes(campaign["audio_data"]),
        media_type=campaign.get("audio_content_type", "audio/mpeg"),
        headers={"Content-Disposition": f'inline; filename="{campaign.get("audio_filename", "campaign_audio")}"'},
    )


@router.post("/api/campaigns/{campaign_id}/upload-audio")
async def upload_audio(campaign_id: str, file: UploadFile = File(...), user: dict = Depends(require_permission("campaigns", "edit"))):
    oid = _oid(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)
    if campaign.get("status", "draft") != "draft":
        raise HTTPException(400, "This campaign has already been launched — it can only be set up and started once.")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(422, "Uploaded file is empty")

    content_type = file.content_type or "audio/mpeg"
    campaigns_collection.update_one({"_id": oid}, {"$set": {
        "audio_filename": file.filename,
        "audio_data": Binary(audio_bytes),
        "audio_content_type": content_type,
    }})
    return {"message": "Audio uploaded", "filename": file.filename}


@router.post("/api/campaigns/{campaign_id}/upload-contacts")
async def upload_contacts(campaign_id: str, file: UploadFile = File(...), user: dict = Depends(require_permission("campaigns", "edit"))):
    oid = _oid(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid})
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

    count = 0
    for _, row in df.iterrows():
        raw = str(row[phone_col]).strip()
        if not raw or raw.lower() == "nan":
            continue
        digits = re.sub(r"\D", "", raw)
        if digits.startswith("91") and len(digits) == 12:
            phone = "+" + digits
        elif len(digits) == 10:
            phone = "+91" + digits
        else:
            phone = "+" + digits

        language_value = None
        if language_col is not None:
            raw_language = str(row[language_col]).strip()
            if raw_language and raw_language.lower() != "nan":
                language_value = raw_language

        contacts_collection.insert_one({
            "campaign_id": oid,
            "phone_number": phone,
            "name": str(row[name_col]) if name_col else None,
            "language": language_value,
        })
        count += 1

    message = f"{count} contacts uploaded"
    if language_col is None:
        message += " (no 'language' column found — every contact will use the campaign's default audio)"
    return {"message": message}


@router.delete("/api/campaigns/{campaign_id}/contacts")
def delete_contacts(campaign_id: str, user: dict = Depends(require_permission("campaigns", "edit"))):
    """Removes every contact uploaded for this campaign so far, so a wrong
    or outdated sheet can be cleared before uploading a new one."""
    oid = _oid(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)
    if campaign.get("status", "draft") != "draft":
        raise HTTPException(400, "This campaign has already been launched — it can only be set up and started once.")

    result = contacts_collection.delete_many({"campaign_id": oid})
    return {"message": f"Deleted {result.deleted_count} contact(s)"}


@router.post("/api/campaigns/{campaign_id}/start")
def start_campaign(campaign_id: str, background_tasks: BackgroundTasks, user: dict = Depends(require_permission("campaigns", "trigger"))):
    oid = _oid(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)

    contacts = list(contacts_collection.find({"campaign_id": oid}))
    if not contacts:
        raise HTTPException(400, "Upload contacts first")

    if campaign.get("status", "draft") != "draft":
        raise HTTPException(400, "This campaign has already been launched — each campaign can only be started once.")

    has_default_audio = bool(campaign.get("audio_filename"))
    has_voice_folder = bool(campaign.get("voice_source_folder_id"))
    contacts_without_language = sum(1 for c in contacts if not c.get("language"))
    contacts_with_language = len(contacts) - contacts_without_language

    if not has_default_audio and contacts_without_language > 0:
        raise HTTPException(
            400,
            f"{contacts_without_language} contact(s) have no language specified and there is no default "
            "campaign audio to fall back on. Either add a 'language' column value for every contact, "
            "or upload a default campaign audio file.",
        )
    if not has_voice_folder and contacts_with_language > 0:
        raise HTTPException(
            400,
            f"{contacts_with_language} contact(s) have a language specified, but no voice folder has been "
            "selected for this campaign yet. Pick a voice folder in Step 1 first.",
        )

    campaigns_collection.update_one({"_id": oid}, {"$set": {"status": "running"}})
    background_tasks.add_task(run_calls, campaign_id)
    return {"message": f"Campaign started — {len(contacts)} calls have been queued"}


def run_calls(campaign_id: str):
    """Groups contacts by which recording they should hear, then fires the
    Sarv vb-api v2 /broadcasting request in batches of up to
    SARV_MAX_CONTACTS_PER_REQUEST numbers per call - passing audio_url
    directly (no separate upload/announcement step needed for this API)."""
    oid = ObjectId(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid})
    contacts = list(contacts_collection.find({"campaign_id": oid}))

    # PUBLIC_BASE_URL can be set manually (needed for ngrok/local); on Render
    # it's auto-filled from RENDER_EXTERNAL_URL, which Render sets to this
    # service's own public https URL automatically - no manual config needed.
    public_base_url = os.getenv("PUBLIC_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL", "")
    has_default_audio = bool(campaign.get("audio_data"))
    voice_folder_id = campaign.get("voice_source_folder_id")
    webhook_secret = os.getenv("SARV_WEBHOOK_SECRET", "")
    callback_url = (
        f"{public_base_url}/api/campaigns/webhooks/sarv-status?key={quote(webhook_secret)}"
        if public_base_url else ""
    )

    cfg_includes_country_code = os.getenv("SARV_INCLUDES_COUNTRY_CODE", "N").strip().upper()

    # audio_ref key -> {"audio_url": ..., "items": [{"call_log_id", "phone_number", "mobile"}]}
    groups: dict[str, dict] = {}

    for contact in contacts:
        language_value = contact.get("language")
        audio_ref, resolve_error = _resolve_language_audio(language_value, voice_folder_id)

        # No per-contact language match - fall back to the campaign's default audio, if any.
        if not audio_ref and has_default_audio and not language_value:
            audio_ref, resolve_error = {"type": "campaign", "campaign_id": campaign_id}, None

        call_log = {
            "campaign_id": oid,
            "contact_id": contact["_id"],
            "phone_number": contact["phone_number"],
            "language": language_value,
            "status": "queued",
            "call_duration": 0,
            "started_at": datetime.utcnow(),
            "ended_at": None,
            "sarv_unique_id": None,
            "error_message": None,
        }
        result = call_logs_collection.insert_one(call_log)
        call_log_id = result.inserted_id

        # Language didn't resolve to a saved recording - never call this number, record why.
        if not audio_ref:
            call_logs_collection.update_one({"_id": call_log_id}, {"$set": {
                "status": "skipped", "error_message": resolve_error, "ended_at": datetime.utcnow(),
            }})
            continue

        if audio_ref["type"] == "tts":
            key = f"tts:{audio_ref['folder_id']}:{audio_ref['filename']}"
            audio_url = f"{public_base_url}/api/tts/download/{quote(audio_ref['folder_id'])}/{quote(audio_ref['filename'])}"
        else:
            key = f"campaign:{audio_ref['campaign_id']}"
            audio_url = f"{public_base_url}/api/campaigns/{audio_ref['campaign_id']}/audio"

        mobile = sarv_client.normalize_mobile(contact["phone_number"], cfg_includes_country_code)
        groups.setdefault(key, {"audio_url": audio_url, "items": []})
        groups[key]["items"].append({
            "call_log_id": call_log_id,
            "phone_number": contact["phone_number"],
            "mobile": mobile,
        })

    for key, group in groups.items():
        items = group["items"]
        for i in range(0, len(items), sarv_client.SARV_MAX_CONTACTS_PER_REQUEST):
            batch = items[i:i + sarv_client.SARV_MAX_CONTACTS_PER_REQUEST]
            mobiles = [b["mobile"] for b in batch]
            try:
                result = sarv_client.trigger_voice_broadcast(group["audio_url"], mobiles, callback_url=callback_url)
                returned = result.get("data", [])
                # Match by mobileNumber rather than position, in case Sarv
                # drops/reorders invalid entries in the response.
                by_mobile = {}
                for row in returned:
                    norm = sarv_client.normalize_mobile(str(row.get("mobileNumber", "")), cfg_includes_country_code)
                    by_mobile[norm] = row

                for b in batch:
                    row = by_mobile.get(b["mobile"])
                    if not row:
                        call_logs_collection.update_one({"_id": b["call_log_id"]}, {"$set": {
                            "status": "failed", "error_message": "No response row from Sarv for this number",
                        }})
                        continue
                    new_status = sarv_client.map_sarv_status(row.get("status"))
                    update = {"status": new_status, "sarv_unique_id": row.get("uniqueId")}
                    if new_status == "failed":
                        update["error_message"] = f"Sarv reported status '{row.get('status')}' for this number"
                        update["ended_at"] = datetime.utcnow()
                    call_logs_collection.update_one({"_id": b["call_log_id"]}, {"$set": update})
            except Exception as exc:
                for b in batch:
                    call_logs_collection.update_one({"_id": b["call_log_id"]}, {"$set": {
                        "status": "failed", "error_message": str(exc)[:500],
                    }})
            time.sleep(1.5)  # small gap between batches

    campaigns_collection.update_one({"_id": oid}, {"$set": {"status": "completed"}})


def _sync_pending_calls_from_sarv(oid: ObjectId):
    """This vb-api v2 endpoint doesn't have a confirmed public "fetch report"
    API (unlike Sarv's older announcement-based API), so we no longer poll
    for status here. Instead, status updates arrive live via the
    `callback_url` passed on every broadcasting request, handled by
    POST /api/campaigns/webhooks/sarv-status below. This function is kept
    as a no-op call site so campaign_status()/download_report() below don't
    need to change - remove it if/when you confirm this is unnecessary."""
    return


@router.delete("/api/campaigns/{campaign_id}")
def delete_campaign(campaign_id: str, user: dict = Depends(require_permission("campaigns", "delete"))):
    """Permanently deletes a campaign: its own record (including any default
    audio stored inside it), every contact uploaded for it, and every call
    log/report row. This cannot be undone."""
    oid = _oid(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid}, {"audio_data": 0})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)

    contacts_deleted = contacts_collection.delete_many({"campaign_id": oid}).deleted_count
    logs_deleted = call_logs_collection.delete_many({"campaign_id": oid}).deleted_count
    campaigns_collection.delete_one({"_id": oid})
    return {
        "message": f"Deleted campaign '{campaign['name']}', {contacts_deleted} contact(s), and {logs_deleted} call log(s)",
    }


@router.get("/api/campaigns/{campaign_id}/status")
def campaign_status(campaign_id: str, user: dict = Depends(require_permission("campaigns", "view"))):
    oid = _oid(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)

    _sync_pending_calls_from_sarv(oid)

    total_contacts = contacts_collection.count_documents({"campaign_id": oid})
    logs = list(call_logs_collection.find({"campaign_id": oid}))
    completed = sum(1 for l in logs if l["status"] == "completed")
    failed_or_declined = sum(1 for l in logs if l["status"] in ("failed", "busy", "no-answer", "canceled", "skipped"))
    in_progress = sum(1 for l in logs if l["status"] in ("queued", "initiated", "ringing", "in-progress"))

    return {
        "total_contacts": total_contacts, "total_calls_triggered": len(logs),
        "completed": completed, "failed_or_declined": failed_or_declined,
        "in_progress": in_progress, "campaign_status": campaign.get("status", "draft"),
    }


@router.get("/api/campaigns/{campaign_id}/report")
def download_report(campaign_id: str, user: dict = Depends(require_permission("campaigns", "view"))):
    oid = _oid(campaign_id)
    campaign = campaigns_collection.find_one({"_id": oid}, {"audio_data": 0})
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    assert_owns_or_admin(user, campaign)
    _sync_pending_calls_from_sarv(oid)

    def clean(value):
        if isinstance(value, str):
            return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value)[:500]
        return value

    logs = list(call_logs_collection.find({"campaign_id": oid}))
    status_label = {
        "completed": "Answered / Completed", "busy": "Declined (Busy)", "no-answer": "Not Answered",
        "failed": "Failed", "canceled": "Cancelled", "initiated": "In Progress",
        "ringing": "Ringing", "in-progress": "Ongoing", "queued": "Queued",
        "skipped": "Skipped — Language Mismatch",
    }
    data = [{
        "Phone Number": l["phone_number"],
        "Language": l.get("language") or "",
        "Status": status_label.get(l["status"], l["status"]),
        "Call Duration (sec)": l.get("call_duration") or 0,
        "Started At": l["started_at"].strftime("%Y-%m-%d %H:%M:%S") if l.get("started_at") else "",
        "Ended At": l["ended_at"].strftime("%Y-%m-%d %H:%M:%S") if l.get("ended_at") else "",
        "Error": clean(l.get("error_message")) if l.get("error_message") else "",
    } for l in logs]

    df = pd.DataFrame(data)
    buffer = io.BytesIO()
    df.to_excel(buffer, index=False, engine="openpyxl")
    buffer.seek(0)
    return StreamingResponse(
        buffer, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=campaign_{campaign_id}_report.xlsx"},
    )


# ------------------------------------------------------------- insights ----

@router.get("/api/obd/overview")
def obd_overview(user: dict = Depends(require_permission("dashboard", "view"))):
    """Aggregate numbers across every campaign, for the insights dashboard.
    A plain user only sees their own campaigns/calls; admin/super_admin see everyone's."""
    campaigns = list(campaigns_collection.find(owner_filter(user), {"audio_data": 0}))
    owned_ids = [c["_id"] for c in campaigns]
    logs_filter = {} if user["role"] in ("super_admin", "admin") else {"campaign_id": {"$in": owned_ids}}
    all_logs = list(call_logs_collection.find(logs_filter).sort("started_at", -1))

    total_calls = len(all_logs)
    completed = sum(1 for l in all_logs if l["status"] == "completed")
    failed = sum(1 for l in all_logs if l["status"] in ("failed", "busy", "no-answer", "canceled", "skipped"))
    running_campaigns = sum(1 for c in campaigns if c.get("status") == "running")

    campaign_names = {c["_id"]: c["name"] for c in campaigns}
    recent_activity = [{
        "campaign_name": campaign_names.get(l["campaign_id"], "Unknown"),
        "phone_number": l["phone_number"],
        "status": l["status"],
        "started_at": l["started_at"].isoformat() if l.get("started_at") else None,
    } for l in all_logs[:8]]

    return {
        "total_calls": total_calls,
        "completed": completed,
        "failed": failed,
        "running_campaigns": running_campaigns,
        "total_campaigns": len(campaigns),
        "success_rate": round((completed / total_calls) * 100, 1) if total_calls else 0,
        "recent_activity": recent_activity,
    }


@router.get("/api/obd/daily-stats")
def obd_daily_stats(user: dict = Depends(require_permission("dashboard", "view"))):
    """Last 7 days of call volume (total/successful/failed), for the Call
    Analytics chart. Grouped by the day each call was started. Scoped to the
    caller's own campaigns unless they're an admin/super_admin."""
    from collections import OrderedDict

    logs_filter = {"started_at": {"$ne": None}}
    if user["role"] not in ("super_admin", "admin"):
        owned_ids = [c["_id"] for c in campaigns_collection.find(owner_filter(user), {"_id": 1})]
        logs_filter["campaign_id"] = {"$in": owned_ids}
    logs = list(call_logs_collection.find(logs_filter))
    buckets: dict[str, dict[str, int]] = OrderedDict()

    today = datetime.utcnow().date()
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        buckets[day.isoformat()] = {"total": 0, "completed": 0, "failed": 0}

    for l in logs:
        day_key = l["started_at"].date().isoformat()
        if day_key not in buckets:
            continue
        buckets[day_key]["total"] += 1
        if l["status"] == "completed":
            buckets[day_key]["completed"] += 1
        elif l["status"] in ("failed", "busy", "no-answer", "canceled", "skipped"):
            buckets[day_key]["failed"] += 1

    return [
        {"date": day, "total": counts["total"], "completed": counts["completed"], "failed": counts["failed"]}
        for day, counts in buckets.items()
    ]


@router.get("/api/obd/campaign-performance")
def obd_campaign_performance(user: dict = Depends(require_permission("dashboard", "view"))):
    """Every campaign ranked by success rate, for the Top Performing
    Campaigns list. Only campaigns with at least one triggered call are
    included. Scoped to the caller's own campaigns unless they're an admin."""
    campaigns = list(campaigns_collection.find(owner_filter(user), {"audio_data": 0}))
    results = []
    for c in campaigns:
        logs = list(call_logs_collection.find({"campaign_id": c["_id"]}))
        if not logs:
            continue
        completed = sum(1 for l in logs if l["status"] == "completed")
        results.append({
            "id": str(c["_id"]),
            "name": c["name"],
            "status": c.get("status", "draft"),
            "total_calls": len(logs),
            "success_rate": round((completed / len(logs)) * 100, 1),
        })
    results.sort(key=lambda r: r["success_rate"], reverse=True)
    return results


# Note: the old /api/campaigns/webhooks/voice and /webhooks/status routes
# were Twilio-specific (Twilio called them mid-call and on status changes).
# Sarv's vb-api v2 /broadcasting instead pushes updates to whatever
# `callback_url` you passed on the original request - handled below.

import logging
logger = logging.getLogger("sarv_webhook")


@router.post("/api/campaigns/webhooks/sarv-status")
async def sarv_status_webhook(request: Request):
    """Sarv calls this URL (the callback_url we send on every broadcasting
    request) to report a call's outcome. The EXACT payload shape hasn't
    been confirmed yet against your account, so this logs the raw body on
    every hit - check your backend's logs after a real test call, then
    tighten the field names below (currently guessing uniqueId/status/
    duration, matching the same names used in the broadcasting response).

    Locked down with a shared-secret key (SARV_WEBHOOK_SECRET) passed as a
    ?key= query param on the callback_url we hand to Sarv - anyone who
    doesn't know that key gets a 403 and nothing is written to the DB. This
    is the only thing that can ever write to call_logs_collection from the
    outside, so it's kept intentionally narrow: it can only flip a status/
    duration/ended_at on a row that already has a matching sarv_unique_id;
    it can't create, delete, or read anything else."""
    expected_secret = os.getenv("SARV_WEBHOOK_SECRET", "")
    if expected_secret and request.query_params.get("key") != expected_secret:
        logger.warning("Sarv callback rejected: missing/incorrect key")
        raise HTTPException(403, "Forbidden")

    try:
        payload = await request.json()
    except Exception:
        form = await request.form()
        payload = dict(form)

    logger.info("Sarv callback received: %s", payload)

    unique_id = payload.get("uniqueId") or payload.get("unique_id")
    status = payload.get("status")
    duration = payload.get("duration") or payload.get("call_duration") or payload.get("answer_duration")

    if not unique_id:
        return {"ok": False, "reason": "no uniqueId in payload - check server logs for the raw body"}

    new_status = sarv_client.map_callback_status(status)
    update = {"status": new_status}
    if duration:
        try:
            update["call_duration"] = float(duration)
        except (TypeError, ValueError):
            pass
    if new_status in ("completed", "busy", "failed", "no-answer"):
        update["ended_at"] = datetime.utcnow()

    call_logs_collection.update_one({"sarv_unique_id": unique_id}, {"$set": update})
    return {"ok": True}


@router.get("/api/campaigns/debug/deployment-check")
def deployment_check():
    """Quick self-check for whether this deployment is actually ready to make
    real calls — hit this once right after deploying, before running a real
    campaign, to catch misconfiguration early instead of finding out via a
    failed call. Doesn't expose secret values, only whether they're set."""
    public_base_url = os.getenv("PUBLIC_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL", "")
    webhook_secret = os.getenv("SARV_WEBHOOK_SECRET", "")
    cfg = sarv_client._config()

    sample_audio_url = f"{public_base_url}/api/campaigns/<id>/audio" if public_base_url else None
    sample_callback_url = (
        f"{public_base_url}/api/campaigns/webhooks/sarv-status?key=***"
        if public_base_url else None
    )

    checks = {
        "public_base_url_detected": bool(public_base_url),
        "public_base_url": public_base_url or None,
        "public_base_url_source": (
            "PUBLIC_BASE_URL (manual)" if os.getenv("PUBLIC_BASE_URL")
            else "RENDER_EXTERNAL_URL (auto)" if os.getenv("RENDER_EXTERNAL_URL")
            else None
        ),
        "webhook_secret_configured": bool(webhook_secret),
        "sarv_user_id_configured": bool(cfg["user_id"]),
        "sarv_user_token_configured": bool(cfg["user_token"]),
        "sarv_plan_id_configured": bool(cfg["plan_id"]),
        "mongodb_connected": check_connection(),
        "sample_audio_url_sarv_will_fetch": sample_audio_url,
        "sample_callback_url_sarv_will_hit": sample_callback_url,
    }
    checks["ready_to_call"] = all([
        checks["public_base_url_detected"],
        checks["webhook_secret_configured"],
        checks["sarv_user_id_configured"],
        checks["sarv_user_token_configured"],
        checks["sarv_plan_id_configured"],
        checks["mongodb_connected"],
    ])
    return checks
