import os
from datetime import datetime

import httpx
from bson import ObjectId, Binary
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from .. import groq_client
from ..auth import require_any_permission, require_permission, owner_filter, assert_owns_or_admin
from ..constants import LANGUAGE_DISPLAY, LANGUAGE_NAMES, resolve_speaker
from ..database import tts_collection, voice_folders_collection

router = APIRouter(prefix="/api/tts", tags=["text-to-speech"])


def _oid(folder_id: str) -> ObjectId:
    try:
        return ObjectId(folder_id)
    except InvalidId:
        raise HTTPException(400, "Invalid folder id")


def _folder_or_404(folder_id: str) -> dict:
    folder = voice_folders_collection.find_one({"_id": _oid(folder_id)})
    if not folder:
        raise HTTPException(404, "Folder not found")
    return folder


# ---------------------------------------------------------------- schemas --

class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120, description="A name for this new voice folder - required")


class GenerateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=30000)
    folder_id: str = Field(description="Which voice folder these generated languages should be saved into")
    languages: list[str] = Field(min_length=1, description="Sarvam language codes, e.g. ['hi-IN','bn-IN']")
    source_language_code: str = Field(default="hi-IN", description="The language the input text is written in")
    gender: str = Field(default="female", description="'male' or 'female' — the best Bulbul v3 speaker for each selected language is picked automatically based on this")
    speaker: str | None = Field(default=None, description="Advanced: force a specific Bulbul v3 speaker for every language, overriding the gender-based auto-pick")
    pace: float = 1.0
    temperature: float = 0.78


# ------------------------------------------------------------ voice folders --

@router.post("/folders")
def create_folder(payload: FolderCreate, user: dict = Depends(require_permission("voices", "create"))):
    """Creates a brand-new, named voice folder. A folder name is required
    every time - this is the mandatory first step before generating speech."""
    doc = {"name": payload.name.strip(), "created_at": datetime.utcnow(), "created_by": user["uid"]}
    result = voice_folders_collection.insert_one(doc)
    return {"id": str(result.inserted_id), "name": doc["name"], "created_at": doc["created_at"]}


@router.get("/folders")
def list_folders(user: dict = Depends(require_any_permission(("tts", "view"), ("voices", "view")))):
    docs = voice_folders_collection.find(owner_filter(user)).sort("created_at", -1)
    folders = []
    for d in docs:
        folder_id = str(d["_id"])
        count = tts_collection.count_documents({"folder_id": folder_id})
        folders.append({"id": folder_id, "name": d["name"], "created_at": d.get("created_at"), "voice_count": count})
    return folders


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str, user: dict = Depends(require_permission("voices", "delete"))):
    """Deletes a voice folder entirely: its DB record and every generated
    language's DB record (audio included, since audio is stored as binary
    data inside those same MongoDB documents - no files on disk to clean up)."""
    oid = _oid(folder_id)
    folder = voice_folders_collection.find_one({"_id": oid})
    if not folder:
        raise HTTPException(404, "Folder not found")
    assert_owns_or_admin(user, folder)

    tts_collection.delete_many({"folder_id": folder_id})
    voice_folders_collection.delete_one({"_id": oid})
    return {"message": f"Deleted folder '{folder['name']}' and all its voices"}


# --------------------------------------------------------- speech generation --

def _split_text(text: str, limit: int = 1800) -> list[str]:
    """Sarvam has a per-request character ceiling, so long scripts are chunked
    on natural sentence/paragraph boundaries and stitched back together."""
    chunks: list[str] = []
    remaining = text.strip()
    markers = ["\n", "।", ". ", "? ", "! ", "; ", ", ", " "]
    while len(remaining) > limit:
        window = remaining[: limit + 1]
        boundary = max((window.rfind(m) for m in markers), default=-1)
        end = boundary + 1 if boundary > limit * 0.55 else limit
        chunks.append(remaining[:end].strip())
        remaining = remaining[end:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


async def _translate_text(text: str, source_code: str, target_code: str, gender: str = "female") -> str:
    """Translates text from one language to another using Groq (openai/gpt-oss-120b, free tier), prompted to
    keep pronouns/verb conjugations consistent with the chosen speaker gender
    (e.g. "करना चाहता हूँ" for male vs "करना चाहती हूँ" for female in Hindi).
    The actual audio is still synthesized by Sarvam afterwards - Groq here
    only produces the target-language text that gets sent to Sarvam TTS."""
    source_name = LANGUAGE_NAMES.get(source_code, source_code)
    target_name = LANGUAGE_NAMES.get(target_code, target_code)
    return await groq_client.translate_text(text, source_name, target_name, gender)


async def _generate_audio_bytes(text: str, language_code: str, speaker: str, pace: float, temperature: float) -> bytes:
    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise HTTPException(503, "SARVAM_API_KEY is not configured on the backend (.env)")

    audio = b""
    async with httpx.AsyncClient(timeout=90) as client:
        for chunk in _split_text(text):
            response = await client.post(
                "https://api.sarvam.ai/text-to-speech/stream",
                headers={"api-subscription-key": api_key, "Content-Type": "application/json"},
                json={
                    "text": chunk,
                    "target_language_code": language_code,
                    "speaker": speaker,
                    "model": "bulbul:v3",
                    "pace": pace,
                    "temperature": temperature,
                    "speech_sample_rate": 24000,
                    "output_audio_codec": "mp3",
                    "output_audio_bitrate": "128k",
                    "enable_preprocessing": True,
                },
            )
            if response.is_error:
                try:
                    detail = response.json().get("error", {}).get("message") or response.text
                except ValueError:
                    detail = response.text
                raise HTTPException(response.status_code, detail or "Sarvam speech generation failed")
            audio += response.content
    return audio


@router.post("/generate")
async def generate_speech(payload: GenerateRequest, user: dict = Depends(require_permission("tts", "generate"))):
    """Generates speech for every selected language, scoped to one voice
    folder. Each language's audio bytes are stored directly inside its
    MongoDB document (tts_audio collection, keyed by folder_id + language) -
    no files are written to disk, so re-generating the same language in the
    same folder simply overwrites that one document's audio_data field."""
    folder = voice_folders_collection.find_one({"_id": _oid(payload.folder_id)})
    if not folder:
        raise HTTPException(404, "Voice folder not found")
    assert_owns_or_admin(user, folder)
    if not payload.text.strip():
        raise HTTPException(422, "Text is required")

    results = []
    for code in payload.languages:
        language_name = LANGUAGE_DISPLAY.get(code)
        if not language_name:
            results.append({"code": code, "language": code, "status": "failed", "error": "Unsupported language code"})
            continue

        filename = f"{language_name.lower()}.mp3"

        try:
            # Translate into this language first (unless the text is already in it),
            # so each generated audio actually speaks that language - not the source text
            # merely voiced with a different speaker.
            if code == payload.source_language_code:
                text_for_this_language = payload.text.strip()
            else:
                text_for_this_language = await _translate_text(payload.text.strip(), payload.source_language_code, code, payload.gender)

            # Use the explicit speaker override if given, otherwise auto-pick the
            # best-performing speaker for THIS language + the chosen gender.
            speaker_for_this_language = payload.speaker or resolve_speaker(code, payload.gender)

            audio_bytes = await _generate_audio_bytes(text_for_this_language, code, speaker_for_this_language, payload.pace, payload.temperature)

            record = {
                "folder_id": payload.folder_id,
                "language_code": code,
                "language_name": language_name,
                "filename": filename,
                "audio_data": Binary(audio_bytes),
                "text": text_for_this_language,
                "source_text": payload.text.strip(),
                "speaker": speaker_for_this_language,
                "gender": payload.gender,
                "updated_at": datetime.utcnow(),
            }
            tts_collection.update_one(
                {"folder_id": payload.folder_id, "language_code": code},
                {"$set": record, "$setOnInsert": {"created_at": datetime.utcnow()}},
                upsert=True,
            )
            results.append({
                "code": code, "language": language_name, "filename": filename,
                "speaker": speaker_for_this_language,
                "status": "success", "download_url": f"/api/tts/download/{payload.folder_id}/{filename}",
            })
        except HTTPException as exc:
            results.append({"code": code, "language": language_name, "status": "failed", "error": str(exc.detail)})
        except Exception as exc:  # noqa: BLE001 - surface any unexpected error to the UI
            results.append({"code": code, "language": language_name, "status": "failed", "error": str(exc)})

    return {"results": results}


@router.get("/history")
def tts_history(folder_id: str | None = Query(default=None, description="Filter to a single folder's voices"), user: dict = Depends(require_any_permission(("tts", "view"), ("voices", "view")))):
    """Generated language audios. Pass folder_id to scope to one folder;
    omit it to list everything (used by the Manage Voices page).

    Records from before folder-scoped voices existed have no folder_id and
    are skipped, since they can no longer be tied to any folder's directory.
    The raw audio_data binary is excluded from this list response - it's
    fetched only on demand via the download endpoint.

    A plain user only ever sees voices in folders THEY created; admin/super_admin see everyone's."""
    if folder_id:
        assert_owns_or_admin(user, _folder_or_404(folder_id))
        query = {"folder_id": folder_id}
    else:
        query = {"folder_id": {"$exists": True, "$ne": None}}
        if user["role"] not in ("super_admin", "admin"):
            owned_folder_ids = [str(f["_id"]) for f in voice_folders_collection.find(owner_filter(user), {"_id": 1})]
            query["folder_id"] = {"$in": owned_folder_ids}
    docs = list(tts_collection.find(query, {"audio_data": 0}).sort("updated_at", -1))
    results = []
    for doc in docs:
        if not doc.get("folder_id"):
            continue
        doc["_id"] = str(doc["_id"])
        doc["download_url"] = f"/api/tts/download/{doc['folder_id']}/{doc['filename']}"
        results.append(doc)
    return results


@router.get("/download/{folder_id}/{filename}")
def download_audio(folder_id: str, filename: str, user: dict = Depends(require_any_permission(("tts", "view"), ("voices", "view")))):
    """Streams the audio straight out of MongoDB in real time - nothing is
    ever read from local disk."""
    assert_owns_or_admin(user, _folder_or_404(folder_id))
    doc = tts_collection.find_one({"folder_id": folder_id, "filename": filename})
    if not doc or not doc.get("audio_data"):
        raise HTTPException(404, "Audio not found")
    return Response(
        content=bytes(doc["audio_data"]),
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.delete("/{folder_id}/{language_code}")
def delete_voice(folder_id: str, language_code: str, user: dict = Depends(require_permission("tts", "delete"))):
    """Removes one generated language's DB record (audio included, since it
    lives inside that same document)."""
    assert_owns_or_admin(user, _folder_or_404(folder_id))
    result = tts_collection.delete_one({"folder_id": folder_id, "language_code": language_code})
    if result.deleted_count == 0:
        raise HTTPException(404, "Voice not found")
    return {"message": "Deleted voice from this folder"}
