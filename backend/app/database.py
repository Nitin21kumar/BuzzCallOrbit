import os
import ssl
import certifi
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "obd_suite")

# Workaround for "SSL: TLSV1_ALERT_INTERNAL_ERROR" seen with very new OpenSSL
# builds (3.2+): they enable newer TLS 1.3 hybrid key-exchange groups by
# default, which some MongoDB Atlas shared/free-tier clusters' TLS
# termination can't handle and reject with a generic internal_error alert.
# Capping the client's TLS handshake at 1.2 avoids offering those groups.
_original_wrap_socket = ssl.SSLContext.wrap_socket


def _capped_wrap_socket(self, *args, **kwargs):
    try:
        self.maximum_version = ssl.TLSVersion.TLSv1_2
    except (ValueError, AttributeError):
        pass
    return _original_wrap_socket(self, *args, **kwargs)


ssl.SSLContext.wrap_socket = _capped_wrap_socket

# tlsCAFile=certifi.where() also fixes a separate, common Windows SSL error
# caused by an outdated/mismatched system certificate store.
client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=8000, tlsCAFile=certifi.where())
db = client[MONGODB_DB]

# Collections
tts_collection = db["tts_audio"]                 # one doc per generated language, e.g. {folder_id, language_code: "hi-IN", filename: "hindi.mp3", ...}
voice_folders_collection = db["voice_folders"]   # named voice folders, independent of OBD campaigns
stt_collection = db["stt_history"]               # transcription history
campaigns_collection = db["campaigns"]
contacts_collection = db["contacts"]
call_logs_collection = db["call_logs"]
users_collection = db["users"]         # {uid, email, name, role, modules, services, fields, active, created_by, created_at}

# WhatsApp OBD (Meta Cloud API)
whatsapp_campaigns_collection = db["whatsapp_campaigns"]   # one doc per broadcast campaign (template + language)
whatsapp_contacts_collection = db["whatsapp_contacts"]     # per-campaign contact list + per-contact send status
whatsapp_messages_collection = db["whatsapp_messages"]     # full conversation log, both directions, keyed by phone number
whatsapp_conversations_collection = db["whatsapp_conversations"]  # one doc per phone number: status, AI handoff state, last message preview
whatsapp_keyword_rules_collection = db["whatsapp_keyword_rules"]  # fixed-reply rules checked before the AI, e.g. "price" -> price list text
whatsapp_settings_collection = db["whatsapp_settings"]      # single global doc: knowledge_base text the AI is grounded on


def check_connection() -> bool:
    try:
        client.admin.command("ping")
        return True
    except Exception:
        return False


def ensure_indexes():
    """Called once on startup. uid/email must be unique so we can never end
    up with two profiles racing to bootstrap as super_admin, etc."""
    try:
        users_collection.create_index("uid", unique=True)
        users_collection.create_index("email", unique=True)
    except Exception:
        pass


