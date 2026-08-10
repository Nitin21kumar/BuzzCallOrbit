"""
Sarv Voice Broadcast integration - vb-api v2 (confirmed via real Postman
request/response against the actual account, not the older public docs).

Endpoint:  GET https://console.sarv.com/vb-api/v2/broadcasting

This version is simpler than Sarv's older announcement_id-based API:
- No separate "upload announcement" step - you pass `audio_url` directly
  on every broadcasting call, so Sarv fetches it itself each time.
- `contacts` is a JSON array of objects (not a comma-separated string),
  e.g. [{"mobile": "9509098340"}, {"mobile": "9876543210"}].
- A `callback_url` field lets Sarv push status updates back to your own
  server instead of you having to poll for them.

Confirmed request params (from a real successful Postman call):
    userId, userToken, apiType=broadcasting, audio_url, planId, planType,
    inputWaitTime, cli ("[]" JSON array), includesCountryCode (Y/N),
    contacts (JSON array of {"mobile": ...}), callback_url,
    extraParameters ("{}" JSON object), extraParametersIndex (Y/N)

Confirmed success response:
    {
      "message": "Success",
      "data": [{"uniqueId": "...", "status": "success", "mobileNumber": "+91..."}],
      "failedCount": 0, "successCount": 1, "invalidCount": 0
    }

UNCONFIRMED / to verify with your own account before relying on them:
- The exact max number of contacts allowed in a single request (the batch
  size below is a conservative guess - adjust once you know Sarv's real limit).
- The exact JSON body Sarv POSTs to your callback_url when a call
  completes (the webhook route below logs the raw payload the first few
  times so you can inspect it and we can tighten the parsing).
- Whether `cli` (caller line identity) needs real values in production -
  currently sent as an empty array "[]" matching the working example.
"""

import json
import os
from typing import Optional

import httpx

BROADCAST_URL = "https://console.sarv.com/vb-api/v2/broadcasting"

# Conservative default - Sarv's real per-request contact limit for this v2
# endpoint isn't documented publicly. Lower this if you see errors with
# large batches, or raise it once you've confirmed the real limit.
SARV_MAX_CONTACTS_PER_REQUEST = int(os.getenv("SARV_MAX_CONTACTS_PER_REQUEST", "100"))


class SarvAPIError(RuntimeError):
    pass


def _config():
    return {
        "user_id": os.getenv("SARV_USER_ID", "").strip(),
        "user_token": os.getenv("SARV_USER_TOKEN", "").strip(),
        "plan_id": os.getenv("SARV_PLAN_ID", "").strip(),
        "plan_type": os.getenv("SARV_PLAN_TYPE", "C").strip(),
        "includes_country_code": os.getenv("SARV_INCLUDES_COUNTRY_CODE", "N").strip().upper(),
        "input_wait_time": os.getenv("SARV_INPUT_WAIT_TIME", "0").strip(),
    }


def _require_config(cfg: dict):
    missing = [k for k in ("user_id", "user_token", "plan_id") if not cfg[k]]
    if missing:
        raise SarvAPIError(
            f"Sarv credentials not configured (missing: {', '.join(missing)}). "
            "Check SARV_USER_ID, SARV_USER_TOKEN, SARV_PLAN_ID in backend/.env"
        )


def normalize_mobile(phone_number: str, includes_country_code: str) -> str:
    """Strips '+' always; strips a leading '91' country code too, unless
    includes_country_code is 'Y' (in which case Sarv expects it kept)."""
    digits = phone_number.lstrip("+")
    if includes_country_code != "Y" and digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    return digits


def trigger_voice_broadcast(audio_url: str, mobile_numbers: list[str], callback_url: str = "") -> dict:
    """Fires one Voice Broadcast (vb-api v2) request for up to
    SARV_MAX_CONTACTS_PER_REQUEST numbers, all hearing the same audio_url.
    Returns Sarv's parsed JSON (data: list of {uniqueId, status, mobileNumber}).
    Raises SarvAPIError on a failed/malformed response.
    Caller is responsible for chunking mobile_numbers into safe batch sizes."""
    if len(mobile_numbers) > SARV_MAX_CONTACTS_PER_REQUEST:
        raise ValueError(f"mobile_numbers exceeds the configured batch size of {SARV_MAX_CONTACTS_PER_REQUEST}")

    cfg = _config()
    _require_config(cfg)

    contacts = json.dumps([{"mobile": m} for m in mobile_numbers], separators=(",", ":"))

    params = {
        "userId": cfg["user_id"],
        "userToken": cfg["user_token"],
        "apiType": "broadcasting",
        "audio_url": audio_url,
        "planId": cfg["plan_id"],
        "planType": cfg["plan_type"],
        "inputWaitTime": cfg["input_wait_time"],
        "cli": "[]",
        "includesCountryCode": cfg["includes_country_code"],
        "contacts": contacts,
        "callback_url": callback_url,
        "extraParameters": "{}",
        "extraParametersIndex": "N",
    }

    with httpx.Client(timeout=30) as client:
        resp = client.get(BROADCAST_URL, params=params)

    try:
        data = resp.json()
    except ValueError:
        raise SarvAPIError(f"Sarv broadcasting returned non-JSON response: {resp.text[:300]}")

    if data.get("message") != "Success":
        raise SarvAPIError(f"Sarv broadcasting failed: {data.get('message', data)}")

    return data


def map_callback_status(status: Optional[str]) -> str:
    """Maps the status Sarv sends on the webhook callback (seen so far:
    "Answered") onto this app's status buckets. This is a DIFFERENT
    vocabulary from map_sarv_status() above, which only covers the
    broadcasting-request response ("success"/"failed"/"invalid"). Extend
    this as you observe more real callback values (e.g. "Busy",
    "No Answer", "Failed", "Rejected")."""
    if not status:
        return "completed"
    s = status.strip().lower()
    if s == "answered":
        return "completed"
    if s == "busy":
        return "busy"
    if s in ("no answer", "noanswer", "not answered", "no-answer"):
        return "no-answer"
    if s in ("failed", "rejected", "cancelled", "canceled", "invalid"):
        return "failed"
    # Unknown value - log it via the caller and default to "completed" since
    # the callback only fires once Sarv has finished processing the call.
    return "completed"


def map_sarv_status(status: Optional[str]) -> str:
    """Maps Sarv's per-contact `status` field (seen so far: "success") onto
    this app's existing status buckets. "success" here just means Sarv
    *accepted and dispatched* the call, not that it was answered - so we
    map it to "initiated" and let the callback (or a manual dashboard
    refresh once you've wired up real-world testing) move it further to
    completed/failed/busy/no-answer. Extend this once you've seen the
    other status/failure strings Sarv actually returns for failed/invalid
    numbers."""
    if not status:
        return "failed"
    s = status.strip().lower()
    if s == "success":
        return "initiated"
    if s in ("failed", "invalid"):
        return "failed"
    return "failed"
