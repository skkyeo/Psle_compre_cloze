"""Home server for Cloze Word Coach.

Serves the app to devices on the home network, marks "Use It" sentences
with Claude (the API key stays on this machine), and keeps the learner's
progress in one file so every device sees the same progress.

Run:  .venv/bin/python server/server.py      (settings in server/config.env)
"""
import datetime
import http.server
import json
import mimetypes
import os
import socket
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA_DIR = HERE / "data"
STATE_FILE = DATA_DIR / "state.json"
BACKUP_DIR = DATA_DIR / "backups"
KEEP_BACKUPS = 30
MAX_BODY = 5 * 1024 * 1024

# Only the app's own files are served; server/, .git and the rest stay private.
PUBLIC_FILES = {"index.html"}
PUBLIC_DIRS = ("css/", "js/", "data/")


def load_config():
    """Read KEY=VALUE lines from server/config.env into the environment (real env vars win)."""
    path = HERE / "config.env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_config()
sys.path.insert(0, str(HERE))
import marking  # noqa: E402  (needs config loaded first)

state_lock = threading.Lock()


def read_state():
    try:
        return STATE_FILE.read_text()
    except FileNotFoundError:
        return "{}"


def write_state(text):
    DATA_DIR.mkdir(exist_ok=True)
    BACKUP_DIR.mkdir(exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(text)
    os.replace(tmp, STATE_FILE)
    # one backup per day, so a bad import or reset can be undone
    today = BACKUP_DIR / f"state-{datetime.date.today().isoformat()}.json"
    today.write_text(text)
    for old in sorted(BACKUP_DIR.glob("state-*.json"))[:-KEEP_BACKUPS]:
        old.unlink()


def clip(value, limit):
    return str(value or "")[:limit]


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "ClozeCoach/1.0"

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/state"):  # skip the frequent autosaves
            super().log_message(fmt, *args)

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("too large")
        return self.rfile.read(length)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self.send_json(200, {"ok": True, "marking": marking.is_configured(), "model": marking.MODEL})
        if path == "/api/state":
            with state_lock:
                text = read_state()
            body = text.encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.serve_static(path)

    def do_PUT(self):
        if self.path != "/api/state":
            return self.send_json(404, {"error": "not found"})
        try:
            text = self.read_body().decode()
            data = json.loads(text)
            if not isinstance(data, dict) or not isinstance(data.get("progress", {}), dict):
                raise ValueError("bad state")
        except ValueError:
            return self.send_json(400, {"error": "Invalid progress data."})
        with state_lock:
            write_state(text)
        self.send_json(200, {"ok": True})

    def do_POST(self):
        if self.path != "/api/grade":
            return self.send_json(404, {"error": "not found"})
        try:
            req = json.loads(self.read_body() or b"{}")
        except ValueError:
            return self.send_json(400, {"error": "Invalid request."})
        sentence = clip(req.get("sentence"), 400).strip()
        word = clip(req.get("word"), 80).strip()
        if not sentence or not word:
            return self.send_json(400, {"error": "Missing word or sentence."})
        try:
            result = marking.grade(
                word=word,
                meaning=clip(req.get("meaning"), 200),
                category=clip(req.get("category"), 60),
                example=clip(req.get("example"), 300),
                sentence=sentence,
                showed_meaning=bool(req.get("showed_meaning")),
            )
        except marking.MarkingError as e:
            return self.send_json(502, {"error": str(e)})
        self.send_json(200, result)

    def serve_static(self, path):
        rel = path.lstrip("/") or "index.html"
        if ".." in rel or not (rel in PUBLIC_FILES or rel.startswith(PUBLIC_DIRS)):
            return self.send_json(404, {"error": "not found"})
        file = ROOT / rel
        if not file.is_file():
            return self.send_json(404, {"error": "not found"})
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    port = int(os.environ.get("PORT", "8000"))
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    host = socket.gethostname().split(".")[0]
    print(f"Cloze Word Coach running. On the home network open: http://{host}.local:{port}")
    if not marking.is_configured():
        print("Note: no ANTHROPIC_API_KEY in server/config.env, so Use It marking is off.")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
