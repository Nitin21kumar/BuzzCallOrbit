"""
Groq integration - used for two things in this app:

1. Translating the source script into every target language before it goes
   to Sarvam TTS, with the translation aware of the chosen speaker gender
   (so pronouns / verb conjugations agree with a male or female voice -
   e.g. Hindi "करना चाहता हूँ" for male vs "करना चाहती हूँ" for female).
2. Cleaning up a raw Sarvam STT transcript (spelling slips, missing
   punctuation, obviously mis-heard words) without changing the language
   or the meaning of what was actually said.

Why Groq instead of Gemini/OpenAI directly: Groq's free developer tier is
genuinely free (no credit card, no billing wall, permanent) and it hosts
OpenAI's own open-weight "gpt-oss-120b" model - so you get real OpenAI-model
quality translation/correction without ever paying. Get a key (takes 30
seconds, no card) from https://console.groq.com/keys

Uses the OpenAI-compatible REST endpoint, so no extra SDK dependency needed.
"""

import os

import httpx
from fastapi import HTTPException

GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def _split_text(text: str, limit: int = 6000) -> list[str]:
    """Safety-net chunker for very long scripts - Groq/gpt-oss-120b has a big
    context window so this rarely triggers in normal OBD script lengths."""
    chunks: list[str] = []
    remaining = text.strip()
    markers = ["\n\n", "\n", "। ", ". ", "? ", "! "]
    while len(remaining) > limit:
        window = remaining[: limit + 1]
        boundary = max((window.rfind(m) for m in markers), default=-1)
        end = boundary + 1 if boundary > limit * 0.5 else limit
        chunks.append(remaining[:end].strip())
        remaining = remaining[end:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


async def _call_groq(prompt: str, system_instruction: str) -> str:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(503, "GROQ_API_KEY is not configured on the backend (.env)")

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )

    if response.is_error:
        try:
            detail = response.json().get("error", {}).get("message") or response.text
        except ValueError:
            detail = response.text
        raise HTTPException(response.status_code, detail or "Groq request failed")

    data = response.json()
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError):
        raise HTTPException(502, "Groq returned no usable text")


async def translate_text(text: str, source_lang_name: str, target_lang_name: str, gender: str) -> str:
    """Translates `text` from source_lang_name into target_lang_name, phrased
    for a {gender} speaker (pronouns / verb conjugations should agree with
    that gender wherever the target language grammatically distinguishes it).
    """
    speaker_gender = "male" if gender == "male" else "female"
    system_instruction = (
        "You are a professional translator for outbound voice-call (OBD) campaign scripts. "
        "Translate the user's text faithfully, preserving its meaning, tone and intent - it will "
        "be read aloud by a text-to-speech voice, so keep it natural, spoken-style language, not "
        "stiff written language. "
        f"The script will be voiced by a {speaker_gender} speaker: wherever the target language's "
        f"grammar distinguishes speaker gender (pronouns, verb conjugations, adjective agreement), "
        f"phrase the translation as a {speaker_gender} speaker would say it. "
        "Break long sentences into shorter, natural spoken sentences (this is a voice script, not a "
        "written document) and punctuate for natural pauses: use commas for short pauses, and end "
        "each sentence with the correct sentence-ending mark for that script (e.g. '।' for Hindi/"
        "Devanagari-based languages, '.' for English) - Sarvam's TTS engine uses this punctuation to "
        "time its pauses and prosody, so under-punctuating makes the audio sound flat and robotic. "
        "Keep any placeholders, numbers, names, dates, and amounts exactly as given. "
        "Output ONLY the translated text in the target language's native script - no explanations, "
        "no quotes, no markdown, no transliteration, no notes."
    )

    translated_parts = []
    for chunk in _split_text(text):
        prompt = f"Source language: {source_lang_name}\nTarget language: {target_lang_name}\n\nText to translate:\n{chunk}"
        translated_parts.append(await _call_groq(prompt, system_instruction))
    return "\n".join(translated_parts).strip()


async def correct_transcript(transcript: str, language_name: str) -> str:
    """Cleans up a raw speech-to-text transcript: fixes obvious spelling
    mistakes, mis-heard/garbled words, and adds reasonable punctuation -
    without changing the language, meaning, or adding/removing content."""
    if not transcript.strip():
        return transcript

    system_instruction = (
        "You are proofreading a raw speech-to-text transcript for an outbound calling (OBD) system. "
        f"The transcript is in {language_name}. Fix likely mishearing/spelling errors and add natural "
        "punctuation and sentence casing where missing. Do NOT translate it into another language. "
        "Do NOT add, remove, or rephrase content beyond fixing clear transcription errors - preserve "
        "the speaker's original wording, meaning and language as closely as possible. "
        "Output ONLY the corrected transcript text - no explanations, no quotes, no markdown."
    )
    prompt = f"Raw transcript:\n{transcript.strip()}"
    return await _call_groq(prompt, system_instruction)
