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


def check_connection() -> bool:
    try:
        client.admin.command("ping")
        return True
    except Exception:
        return False


