# server.py  Quantum Core v2.0
# Enhanced Python backend with context memory, room management, and robust audio pipeline.
# TTS process control

import os
import re
import sqlite3
import threading
import logging
import subprocess
import tempfile
import uuid
from threading import Lock
from werkzeug.utils import secure_filename
from flask import Flask, request, jsonify, send_from_directory
import pyttsx3
from faster_whisper import WhisperModel

# ── NEW: Kokoro-ONNX imports ──────────────────────────────────────────────────
try:
    from kokoro_onnx import KokoroONNX
    import soundfile as sf
    _kokoro_imports_ok = True
except ImportError:
    _kokoro_imports_ok = False
# ─────────────────────────────────────────────────────────────────────────────

# ⚙️ CONFIGURATION ⚙️
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
DB_PATH = os.path.join(STORAGE_DIR, "quantum_memory.db")
WHISPER_MODEL_PATH = os.path.join(BASE_DIR, "model", "whisper_model")
OLLAMA_URL = "http://localhost:11434/api/chat"  # Set None to disable
OLLAMA_MODEL = "hermes3"
SYSTEM_PROMPT = (
    "You are Quantum Core v2.0, an advanced local AI assistant built by m-mekhlafi. "
    "You are running completely offline on the user's machine. "
    "You are knowledgeable, precise, and helpful. "
    "The user's name is [Mohammed AL-Mekhlafi]. "
    "Format your responses using Markdown when appropriate "
    "(use code blocks, headers, bullet points). "
    "Always be concise but thorough."
)

os.makedirs(STORAGE_DIR, exist_ok=True)
logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

app = Flask(__name__, static_folder="website", static_url_path="")

# ─────────────────────────────────────────────────────────────────────────────
# استيراد وتهيئة محرك Import and preparation Kokoro
# ─────────────────────────────────────────────────────────────────────────────
try:
    from kokoro_onnx import Kokoro as KokoroEngine
    import soundfile as sf

    _kokoro_imports_ok = True
except ImportError:
    KokoroEngine = None
    sf = None
    _kokoro_imports_ok = False

_kokoro_engine = None

if _kokoro_imports_ok:
    _kokoro_onnx_path = os.path.join(BASE_DIR, "kokoro-v1.0.onnx")
    _kokoro_voices_path = os.path.join(BASE_DIR, "voices-v1.0.bin")

    try:
        # We use KokoroEngine
        if os.path.exists(_kokoro_onnx_path) and os.path.exists(_kokoro_voices_path):
            _kokoro_engine = KokoroEngine(_kokoro_onnx_path, _kokoro_voices_path)
            logging.info("[+] Kokoro TTS engine loaded successfully.")
        else:
            logging.warning("[!] Kokoro model files not found. Falling back to pyttsx3.")

    except Exception as e:
        _kokoro_engine = None
        logging.error("[!] Failed to initialize Kokoro engine: %s. Falling back to pyttsx3.", e)
else:
    logging.warning("[!] kokoro_onnx or soundfile not installed. Falling back to pyttsx3.")
# ─────────────────────────────────────────────────────────────────────────────

# 🌐 CORS HEADERS (for local development) 🌐
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    return response

@app.route('/api/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    return jsonify({}), 200

# 🎙️ WHISPER (lazy load) 🎙️
_whisper_model = None
_whisper_lock = Lock()

def get_whisper_model():
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is None:
            logging.info("[+] Loading local Whisper model...")
            _whisper_model = WhisperModel(
                WHISPER_MODEL_PATH, device="cpu",
                compute_type="int8", local_files_only=True
            )
    return _whisper_model

# 🗄️ DATABASE 🗄️
def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                title TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT,
                sender TEXT,
                text TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
            )
        """)
        # Default room
        c.execute("SELECT id FROM rooms WHERE id='cybersecurity'")
        if not c.fetchone():
            c.execute("INSERT INTO rooms (id, title) VALUES ('cybersecurity', 'Cybersecurity Analyst Room')")
        conn.commit()

init_db()

# 🔊 TTS ENGINE 🔊
tts_engine = pyttsx3.init()
tts_lock = Lock()

def speak_text_local(text):
    """Run TTS in a background thread to avoid blocking the response.
    Primary engine: Kokoro-ONNX. Fallback: pyttsx3."""

    def _speak():
        # ── Text cleaning (shared by both engines) ────────────────────────────
        clean = text.replace("`", "").replace("*", "").replace("#", "")
        # Remove fenced code blocks entirely
        clean = re.sub(r"```.*?```", "", clean, flags=re.DOTALL)
        clean = clean.strip()[:500]  # Limit TTS length sec
        # ─────────────────────────────────────────────────────────────────────

        # ── Primary: Kokoro-ONNX ──────────────────────────────────────────────
        if _kokoro_engine is not None:
            try:
                # Generate audio samples (returns numpy array + sample rate)
                samples, sample_rate = _kokoro_engine.create(clean, voice="af_heart", speed=1.0)

                # Write to a temporary WAV file in STORAGE_DIR
                out_wav = os.path.join(STORAGE_DIR, f"tts_{uuid.uuid4().hex}.wav")
                sf.write(out_wav, samples, sample_rate)

                # Play on Linux via aplay (non-blocking call inside the thread)
                subprocess.run(["aplay", "-q", out_wav], check=False)

                # Clean up temp file
                try:
                    os.remove(out_wav)
                except Exception:
                    pass

                return  # Primary engine succeeded — we're done
            except Exception as kokoro_err:
                logging.error("[!] Kokoro-ONNX runtime error: %s. Falling back to pyttsx3.", kokoro_err)
                # Fall through to pyttsx3 below
        # ─────────────────────────────────────────────────────────────────────

        # ── Fallback: pyttsx3 ─────────────────────────────────────────────────
        try:
            with tts_lock:
                tts_engine.setProperty("rate", 170)
                tts_engine.setProperty("volume", 0.9)
                tts_engine.say(clean)
                tts_engine.runAndWait()
        except Exception as pyttsx3_err:
            logging.error("[!] pyttsx3 fallback error: %s", pyttsx3_err)
        # ─────────────────────────────────────────────────────────────────────

    threading.Thread(target=_speak, daemon=True).start()

# 🔄 AUDIO CONVERSION 🔄
def ext_from_mime(mime):
    m = (mime or "").lower()
    if "wav" in m:  return "wav"
    if "ogg" in m:  return "ogg"
    if "mp3" in m or "mpeg" in m: return "mp3"
    return "webm"

def convert_to_wav(input_path, out_wav):
    """Convert any audio format to 16kHz mono WAV for Whisper."""
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
           "-i", input_path, "-ar", "16000", "-ac", "1", out_wav]
    try:
        subprocess.run(cmd, check=True, stderr=subprocess.PIPE)
        return True
    except subprocess.CalledProcessError as e:
        logging.warning("ffmpeg default failed: %s", e.stderr.decode(errors='ignore'))
        for fmt in ("webm", "ogg", "mp3"):
            try:
                cmd2 = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                        "-f", fmt, "-i", input_path, "-ar", "16000", "-ac", "1", out_wav]
                subprocess.run(cmd2, check=True, stderr=subprocess.PIPE)
                logging.info("Converted with forced format: %s", fmt)
                return True
            except subprocess.CalledProcessError:
                continue
    raise RuntimeError("All ffmpeg conversion attempts failed.")

# 🤖 LLM CALL 🤖
def ask_quantum(user_text, history=None):
    """
    Call the local Ollama LLM with conversation history for context.
    history: list of {"role": "user"|"assistant", "content": str}
    """
    if not OLLAMA_URL:
        return f"[Local LLM disabled] You said: {user_text}"
    try:
        import requests
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        if history:
            # Limit to last 10 exchanges to stay within context window
            messages.extend(history[-20:])
        else:
            messages.append({"role": "user", "content": user_text})

        payload = {"model": OLLAMA_MODEL, "messages": messages, "stream": False}
        r = requests.post(OLLAMA_URL, json=payload, timeout=120)
        r.raise_for_status()
        return r.json().get("message", {}).get("content", "No response from model.")
    except Exception as e:
        logging.error("Ollama error: %s", e)
        return "⚠️ Quantum Core is offline. Check that Ollama is running."

# 🛣️ ROUTES 🛣️
@app.route("/api/stop-audio", methods=["POST"])
def stop_audio():
    """Emergency stop for TTS audio playback (Linux target)"""
    try:
        # Kill the aplay process immediately to stop Kokoro audio
        subprocess.run(["pkill", "-9", "aplay"], check=False)
        return jsonify({"status": "Voice interrupted successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

# ROOMS — GET all, POST create, PUT rename, DELETE remove
@app.route("/api/rooms", methods=["GET", "POST"])
def rooms_route():
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        if request.method == "POST":
            data = request.json or {}
            rid, title = data.get("id"), data.get("title", data.get("id", ""))
            if not rid:
                return jsonify({"error": "Missing room id"}), 400
            c.execute("INSERT OR IGNORE INTO rooms (id, title) VALUES (?, ?)", (rid, title))
            conn.commit()
            return jsonify({"status": "ok", "id": rid, "title": title})
        c.execute("SELECT id, title FROM rooms ORDER BY timestamp DESC")
        return jsonify([{"id": r[0], "title": r[1]} for r in c.fetchall()])

@app.route("/api/rooms/<room_id>", methods=["PUT", "DELETE"])
def room_manage(room_id):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        if request.method == "PUT":
            data = request.json or {}
            title = data.get("title", room_id)
            c.execute("UPDATE rooms SET title=? WHERE id=?", (title, room_id))
            conn.commit()
            return jsonify({"status": "ok"})
        if request.method == "DELETE":
            if room_id == "cybersecurity":
                return jsonify({"error": "Cannot delete default room"}), 400
            c.execute("DELETE FROM messages WHERE room_id=?", (room_id,))
            c.execute("DELETE FROM rooms WHERE id=?", (room_id,))
            conn.commit()
            return jsonify({"status": "deleted"})

# MESSAGES — GET history
@app.route("/api/messages/<room_id>", methods=["GET"])
def messages_route(room_id):
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute("SELECT sender, text FROM messages WHERE room_id=? ORDER BY id ASC", (room_id,))
        return jsonify([{"sender": r[0], "text": r[1]} for r in c.fetchall()])

# CHAT — POST with context history
@app.route("/api/chat", methods=["POST"])
def chat_route():
    data = request.json or {}
    room_id  = data.get("room_id", "cybersecurity")
    user_msg = data.get("message", "").strip()
    is_temp  = data.get("is_temp", False)
    history  = data.get("history", None)  # Conversation context from frontend

    if not user_msg:
        return jsonify({"error": "Empty message"}), 400

    ai_response = ask_quantum(user_msg, history)

    if not is_temp:
        with sqlite3.connect(DB_PATH) as conn:
            c = conn.cursor()
            # Ensure room exists
            c.execute("INSERT OR IGNORE INTO rooms (id, title) VALUES (?, ?)", (room_id, room_id))
            c.execute("INSERT INTO messages (room_id, sender, text) VALUES (?, 'user', ?)", (room_id, user_msg))
            c.execute("INSERT INTO messages (room_id, sender, text) VALUES (?, 'ai', ?)", (room_id, ai_response))
            conn.commit()

    return jsonify({"response": ai_response})

# VOICE CALL — POST audio for STT → LLM → TTS
@app.route("/api/voice-call", methods=["POST"])
def voice_call():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file"}), 400

    audio_file = request.files["audio"]
    room_id    = request.form.get("room_id", "cybersecurity")
    mime       = (audio_file.mimetype or "").lower()
    ext        = ext_from_mime(mime)

    temp_in  = os.path.join(STORAGE_DIR, f"vc_in{uuid.uuid4().hex}.{ext}")
    temp_wav = None

    try:
        audio_file.save(temp_in)
        size = os.path.getsize(temp_in)
        logging.info("Voice input: %s bytes, mime=%s", size, mime)

        if size < 100:
            return jsonify({"error": "Audio too short or empty"}), 400

        fd, temp_wav = tempfile.mkstemp(suffix=".wav", dir=STORAGE_DIR)
        os.close(fd)

        convert_to_wav(temp_in, temp_wav)

        # Transcribe with Whisper
        whisper  = get_whisper_model()
        segments, info = whisper.transcribe(temp_wav, beam_size=5)
        user_text = " ".join(s.text for s in segments).strip()
        logging.info("STT: '%s'", user_text)

        if not user_text:
            return jsonify({"status": "empty", "ai_response": ""})

        ai_response = ask_quantum(user_text)
        logging.info("LLM: '%s'", ai_response[:80])

        # TTS (non-blocking)
        speak_text_local(ai_response)

        # Persist to DB
        with sqlite3.connect(DB_PATH) as conn:
            c = conn.cursor()
            c.execute("INSERT OR IGNORE INTO rooms (id, title) VALUES (?, ?)", (room_id, room_id))
            c.execute("INSERT INTO messages (room_id, sender, text) VALUES (?, 'user', ?)", (room_id, f"🎤 {user_text}"))
            c.execute("INSERT INTO messages (room_id, sender, text) VALUES (?, 'ai', ?)", (room_id, ai_response))
            conn.commit()

        return jsonify({"status": "success", "user_text": user_text, "ai_response": ai_response})


    except Exception as e:

        logging.exception("Voice pipeline error")

        # ? التعديل الأمني: إرسال رسالة عامة لتجنب ثغرة CWE-209

        return jsonify({"error": "An internal voice pipeline processing error occurred"}), 500

    finally:
        for p in [temp_in, temp_wav]:
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(app.static_folder, path)

if __name__ == "__main__":
    logging.info("=" * 50)
    logging.info("  Quantum Core — Running at http://127.0.0.1:5000")
    logging.info("  LLM: %s | Offline: True", OLLAMA_MODEL)
    logging.info("=" * 50)
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
