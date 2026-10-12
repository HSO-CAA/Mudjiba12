"""
واجهة TikTok Bot: سيرفر صغير على الجهاز + نافذة Edge تعرض الواجهة.
المتصفح يعرض العربي صح (حروف متصلة ومن اليمين لليسار)، عكس tkinter.
"""

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import bot

HERE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
UI_FILE = HERE / "ui.html"

log = logging.getLogger("bot")


class LogBuffer(logging.Handler):
    def __init__(self, limit=500):
        super().__init__()
        self.lines = []
        self.offset = 0  # عدد السطور اللي انحذفت من البداية
        self.limit = limit
        self.buf_lock = threading.Lock()

    def emit(self, record):
        with self.buf_lock:
            self.lines.append(self.format(record))
            if len(self.lines) > self.limit:
                drop = len(self.lines) - self.limit
                del self.lines[:drop]
                self.offset += drop

    def since(self, n):
        with self.buf_lock:
            start = max(0, n - self.offset)
            return self.lines[start:], self.offset + len(self.lines)


class Controller:
    def __init__(self):
        self.logs = LogBuffer()
        self.logs.setFormatter(logging.Formatter("%(asctime)s  %(message)s", "%H:%M:%S"))
        self.account = None  # حساب تيك توك مال هاي النافذة
        self.account_lock = None
        self.select_lock = threading.Lock()
        self.worker = None
        self.stop_event = threading.Event()
        self.mode = "idle"

    def busy(self):
        return self.worker is not None and self.worker.is_alive()

    def start(self, mode, *args):
        if self.busy():
            return False
        self.stop_event = threading.Event()
        runner = bot.Bot(self.stop_event)

        def target():
            try:
                getattr(runner, mode)(*args)
            except bot.Stopped:
                log.info("توقف.")
            except Exception as e:
                log.error("صار خطأ: %s", e)

        self.mode = mode
        self.worker = threading.Thread(target=target, daemon=True)
        self.worker.start()
        return True

    def stop(self):
        self.stop_event.set()

    def select(self, name, create):
        """نربط هاي النافذة بحساب واحد. ما نسمح بنفس الحساب بنافذتين."""
        with self.select_lock:
            name = bot.clean_account_name(name)
            if not name:
                return "اكتب اسم للحساب."
            if self.account:
                return None if name == self.account else "هاي النافذة مربوطة بحساب ثاني. افتح نافذة جديدة."
            exists = name in bot.list_accounts()
            if create and exists:
                return "في حساب بنفس الاسم."
            if not create and not exists:
                return "ماكو حساب بهذا الاسم."
            lock = bot.AccountLock(name)
            if not lock.acquire():
                return "هذا الحساب مفتوح بنافذة ثانية."
            bot.use_account(name, create=create)
            bot.setup_logging(self.logs)
            self.account, self.account_lock = name, lock
            log.info("الحساب: %s", name)
            return None

    def release(self):
        if self.account_lock:
            self.account_lock.release()


def open_new_window():
    """يشغل نسخة ثانية من البرنامج (نافذة جديدة لحساب ثاني)."""
    env = dict(os.environ)
    if getattr(sys, "frozen", False):
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"  # النسخة الجديدة ما تعتمد على ملفات النسخة الحالية
        cmd = [sys.executable]
    else:
        cmd = [sys.executable, str(Path(__file__).resolve())]
    subprocess.Popen(cmd, env=env, cwd=str(bot.BASE))


ctl = Controller()
shutdown = threading.Event()
config_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # بدون رسائل بالكونسول
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n)) if n else {}

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self._send(200, UI_FILE.read_bytes(), "text/html; charset=utf-8")
        if self.path == "/api/accounts":
            return self._send(200, {
                "current": ctl.account,
                "accounts": [{"name": n, "open": n != ctl.account and bot.AccountLock.is_locked(n),
                              "logged_in": bot.is_logged_in(n)} for n in bot.list_accounts()],
            })
        if not ctl.account:
            return self._send(409, {"error": "اختار حساب أول."})
        if self.path == "/api/config":
            with config_lock:
                return self._send(200, bot.load_config())
        if self.path.startswith("/api/status"):
            try:
                n = int(self.path.split("since=")[1])
            except (IndexError, ValueError):
                n = 0
            lines, total = ctl.logs.since(n)
            return self._send(200, {"mode": ctl.mode if ctl.busy() else "idle", "log": lines, "total": total,
                                    "account": ctl.account, "logged_in": bot.is_logged_in()})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        # نقبل بس الطلبات من الواجهة نفسها، مو من مواقع ثانية
        if self.headers.get("Origin") != f"http://127.0.0.1:{self.server.server_port}":
            return self._send(403, {"error": "forbidden"})
        body = self._body()
        if self.path == "/api/select":
            err = ctl.select(body.get("name", ""), bool(body.get("create")))
            return self._send(200, {"ok": not err, "error": err, "account": ctl.account})
        if self.path == "/api/new_window":
            open_new_window()
            return self._send(200, {"ok": True})
        if not ctl.account:
            return self._send(409, {"error": "اختار حساب أول."})
        if self.path == "/api/config":
            with config_lock:
                cfg = bot.load_config()
                cfg.update(body)
                cfg["accounts"] = {bot.clean_user(u): [c.strip() for c in cs if c.strip()]
                                   for u, cs in body.get("accounts", {}).items() if bot.clean_user(u)}
                bot.save_config(cfg)
            return self._send(200, {"ok": True})
        if self.path == "/api/action":
            act = body.get("action")
            if act == "stop":
                ctl.stop()
                return self._send(200, {"ok": True})
            with config_lock:
                has_accounts = bool(bot.load_config()["accounts"])
            if act == "run" and not has_accounts:
                return self._send(200, {"ok": False, "error": "ضيف حساب واحد على الأقل."})
            if act == "test" and "tiktok.com" not in (body.get("url") or ""):
                return self._send(200, {"ok": False, "error": "هذا مو رابط تيك توك."})
            if act in ("run", "login", "test"):
                args = (body["url"].strip(),) if act == "test" else ()
                ok = ctl.start(act, *args)
                return self._send(200, {"ok": ok, "error": None if ok else "في عملية شغالة، أوقفها أول."})
            return self._send(400, {"error": "unknown action"})
        self._send(404, {"error": "not found"})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"

    browser = bot.find_browser()
    # بروفايل مؤقت للواجهة: كل نافذة تصير عملية مستقلة، ولما تتسكر النافذة البرنامج يطفي
    ui_profile = tempfile.mkdtemp(prefix="tiktokbot-ui-")
    if browser:
        proc = subprocess.Popen([
            browser, f"--app={url}", f"--user-data-dir={ui_profile}",
            "--window-size=1050,860", "--no-first-run", "--no-default-browser-check",
            "--disable-features=Translate,TranslateUI",  # الواجهة عربية، لا يترجمها Edge للإنكليزي
        ])
        while proc.poll() is None and not shutdown.is_set():
            time.sleep(0.5)
    else:
        webbrowser.open(url)
        shutdown.wait()

    ctl.stop()
    if ctl.worker:
        ctl.worker.join(timeout=10)
    ctl.release()
    server.shutdown()
    time.sleep(1)  # نخلي المتصفح يفك ملفات البروفايل المؤقت
    shutil.rmtree(ui_profile, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log.exception("البرنامج وكف")
        if os.name == "nt":  # بدون شاشة سودة، فنطلع الخطأ برسالة
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, f"صار خطأ:\n{e}", "TikTok Bot", 0x10)
        raise
