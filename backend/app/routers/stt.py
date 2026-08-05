import os
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from .. import groq_client
from ..constants import LANGUAGE_DISPLAY
from ..database import stt_collection

router = APIRouter(prefix="/api/stt", tags=["speech-to-text"])


@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    language_code: str = Form("unknown"),
    translate_to_english: bool = Form(False),
):
    """Transcribes an uploaded audio file using Sarvam AI (Saaras v3).
    If translate_to_english is True, uses Saaras v3's mode="translate" so the
    output is a proper English translation of the speech - not the original
    language's words merely transliterated into Latin script."""
    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise HTTPException(503, "SARVAM_API_KEY is not configured on the backend (.env)")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(422, "Uploaded file is empty")

    # Browsers report MediaRecorder content-types with a codec suffix, e.g.
    # "audio/webm;codecs=opus" - Sarvam only accepts the exact base MIME type
    # (e.g. "audio/webm"), so strip anything after the ';' before forwarding.
    content_type = (file.content_type or "audio/mpeg").split(";")[0].strip()
    mode = "translate" if translate_to_english else "transcribe"

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": api_key},
                data={"model": "saaras:v3", "language_code": language_code, "mode": mode},
                files={"file": (file.filename, audio_bytes, content_type)},
            )
    except httpx.RequestError as exc:
        raise HTTPException(502, "Could not connect to Sarvam AI") from exc

    if response.is_error:
        try:
            detail = response.json().get("error", {}).get("message") or response.text
        except ValueError:
            detail = response.text
        raise HTTPException(response.status_code, detail or "Transcription failed")

    data = response.json()
    raw_transcript = data.get("transcript", "")
    detected_language = data.get("language_code", language_code)

    # Sarvam gives the raw transcript; Groq (OpenAI's gpt-oss-120b, free tier)
    # then proofreads it (fixes mis-heard words, spelling, missing
    # punctuation) without translating it or changing what was actually said.
    # When translate_to_english was used, the transcript is already English,
    # so proofread it as English rather than as whatever language was spoken.
    language_name = "English" if translate_to_english else LANGUAGE_DISPLAY.get(detected_language, detected_language)
    try:
        corrected_transcript = await groq_client.correct_transcript(raw_transcript, language_name)
    except HTTPException:
        # If Groq correction fails (e.g. no API key configured), fall back
        # to the raw Sarvam transcript rather than failing the whole request.
        corrected_transcript = raw_transcript

    output_language_code = "en-IN" if translate_to_english else detected_language

    stt_collection.insert_one({
        "filename": file.filename,
        "transcript": corrected_transcript,
        "raw_transcript": raw_transcript,
        "language_code": output_language_code,
        "spoken_language_code": detected_language,
        "created_at": datetime.utcnow(),
    })

    return {
        "transcript": corrected_transcript,
        "raw_transcript": raw_transcript,
        "language_code": output_language_code,
        "spoken_language_code": detected_language,
    }


@router.get("/history")
def stt_history():
    docs = list(stt_collection.find().sort("created_at", -1).limit(50))
    for doc in docs:
        doc["_id"] = str(doc["_id"])
    return docs
