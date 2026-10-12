"""
محرك البوت: يراقب مجموعة حسابات تيك توك، وأول ما ينزل فيديو جديد
يسوي لايك + حفظ + تعليق (تعليق مختلف لكل حساب).

كل حساب تيك توك إله فولدر خاص بـ accounts/<الاسم> بيه الجلسة والإعدادات والسجل،
فتكدر تشغل أكثر من حساب بنفس الوقت (كل واحد بنافذة).

الواجهة موجودة بـ app.py. هذا الملف يشتغل بدونها أيضاً:
    python bot.py <حساب> login     # يفتح نافذة تيك توك حتى تسجل دخول، سكرها لما تخلص
    python bot.py <حساب> run       # يبدأ المراقبة
    python bot.py <حساب> test URL  # يجرب لايك/حفظ/تعليق على فيديو معين
"""

import json
import logging
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

# لما يشتغل كـ exe، الملفات تنحفظ جنب الـ exe
BASE = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
ACCOUNTS_DIR = BASE / "accounts"

# تتحدد لما نختار الحساب بـ use_account()
ACCOUNT = None
CONFIG_FILE = STATE_FILE = PROFILE_DIR = LOGIN_FILE = LOG_FILE = None

VIDEO_ID_RE = re.compile(r"/video/(\d+)")

# TikTok يغير الواجهة أحياناً، لهذا كل عنصر إله أكثر من محدد
SELECTORS = {
    "like": ['[data-e2e="like-icon"]', '[data-e2e="browse-like-icon"]'],
    "save": ['[data-e2e="undefined-icon"]', '[data-e2e="favorite-icon"]', '[data-e2e="browse-favorite-icon"]'],
    "comment_input": ['[data-e2e="comment-input"] [contenteditable="true"]', 'div[contenteditable="true"]'],
    "comment_post": ['[data-e2e="comment-post"]'],
}

DEFAULT_CONFIG = {
    "check_interval_minutes": [4, 8],
    "max_actions_per_hour": 10,
    "headless": False,
    "do_like": True,
    "do_save": True,
    "do_comment": True,
    "default_comments": ["تحفة 🔥", "استمر يا بطل 👏", "محتوى رهيب ❤️"],
    "accounts": {},
}

log = logging.getLogger("bot")


def find_browser():
    for n in ("msedge", "chrome", "google-chrome", "chromium"):
        p = shutil.which(n)
        if p:
            return p
    for root in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if not root:
            continue
        for rel in (r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"):
            p = Path(root) / rel
            if p.exists():
                return str(p)
    return None


class Stopped(Exception):
    """ينرمي لما المستخدم يدوس إيقاف."""


# ---------- حسابات تيك توك (كل حساب بفولدر) ----------

BAD_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def clean_account_name(name):
    name = BAD_NAME_CHARS.sub("", name or "").strip().strip(".")
    return name[:40]


def _migrate_legacy():
    """النسخ القديمة كانت تحفظ حساب واحد جنب الـ exe، ننقله لفولدر حساب."""
    old = [BASE / n for n in ("config.json", "state.json", "profile", "login.json")]
    if ACCOUNTS_DIR.exists() or not any(p.exists() for p in old):
        return
    dest = ACCOUNTS_DIR / "حسابي"
    dest.mkdir(parents=True)
    for p in old:
        if p.exists():
            shutil.move(str(p), str(dest / p.name))


def list_accounts():
    _migrate_legacy()
    if not ACCOUNTS_DIR.exists():
        return []
    return sorted(p.name for p in ACCOUNTS_DIR.iterdir() if p.is_dir())


def use_account(name, create=False):
    global ACCOUNT, CONFIG_FILE, STATE_FILE, PROFILE_DIR, LOGIN_FILE, LOG_FILE
    name = clean_account_name(name)
    root = ACCOUNTS_DIR / name
    if not name:
        raise ValueError("اسم الحساب فارغ.")
    if create:
        root.mkdir(parents=True, exist_ok=True)
    elif not root.is_dir():
        raise ValueError(f"ماكو حساب باسم {name}.")
    ACCOUNT = name
    CONFIG_FILE = root / "config.json"
    STATE_FILE = root / "state.json"
    PROFILE_DIR = root / "profile"
    LOGIN_FILE = root / "login.json"
    LOG_FILE = root / "bot.log"
    return name


def is_logged_in(name=None):
    """آخر نتيجة فحص لتسجيل الدخول (من غير ما نفتح متصفح)."""
    f = (ACCOUNTS_DIR / name / "login.json") if name else LOGIN_FILE
    try:
        return bool(json.loads(f.read_text(encoding="utf-8")).get("logged_in"))
    except Exception:
        return False


class AccountLock:
    """قفل على فولدر الحساب حتى ما ينفتح نفس الحساب بنافذتين. ينفك وحده إذا البرنامج انطفى."""

    def __init__(self, name):
        self.path = ACCOUNTS_DIR / name / ".lock"
        self.fh = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(self.path, "a+")
        try:
            if os.name == "nt":
                import msvcrt
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fh.close()
            return False
        self.fh = fh
        return True

    def release(self):
        if not self.fh:
            return
        try:
            if os.name == "nt":
                import msvcrt
                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_UN)
        finally:
            self.fh.close()
            self.fh = None

    @classmethod
    def is_locked(cls, name):
        lock = cls(name)
        if lock.acquire():
            lock.release()
            return False
        return True


# ---------- config / state ----------

def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        cfg.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
    cfg["accounts"] = {clean_user(u): c for u, c in cfg["accounts"].items() if clean_user(u)}
    return cfg


def save_config(cfg):
    _atomic_write(CONFIG_FILE, cfg)


def _atomic_write(path, data):
    """نكتب بملف مؤقت وبعدين نبدله، حتى الملف ما يخرب إذا انقطع البرنامج بالنص."""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def clean_user(u):
    return u.strip().lstrip("@").strip().lower()


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"last_id": {}, "used_comments": {}}


def save_state(state):
    _atomic_write(STATE_FILE, state)


def pick_comment(cfg, state, user):
    """يختار تعليق للحساب، وما يكرر نفس التعليق إلا بعد ما تخلص كل التعليقات."""
    pool = cfg["accounts"].get(user) or cfg.get("default_comments") or []
    if not pool:
        return None
    used = state["used_comments"].setdefault(user, [])
    fresh = [c for c in pool if c not in used]
    if not fresh:
        used.clear()
        fresh = list(pool)
    choice = random.choice(fresh)
    used.append(choice)
    return choice


# ---------- browser helpers ----------

class Bot:
    def __init__(self, stop_event=None):
        self.stop_event = stop_event or threading.Event()

    def sleep(self, seconds):
        if self.stop_event.wait(seconds):
            raise Stopped()

    def human_pause(self, a=1.5, b=4.0):
        self.sleep(random.uniform(a, b))

    def first_visible(self, page, keys, timeout=8000):
        """يرجع أول عنصر ظاهر من قائمة المحددات."""
        deadline = time.time() + timeout / 1000
        while time.time() < deadline:
            for sel in keys:
                loc = page.locator(sel).first
                try:
                    if loc.count() and loc.is_visible():
                        return loc
                except Exception:
                    pass
            self.sleep(0.4)
        return None

    @staticmethod
    def is_pressed(loc):
        """يتأكد إذا اللايك/الحفظ مفعّل مسبقاً حتى ما نلغيه بالغلط."""
        try:
            return loc.evaluate(
                "el => { const b = el.closest('button') || el;"
                " return b.getAttribute('aria-pressed') === 'true'; }"
            )
        except Exception:
            return False

    @staticmethod
    def open_context(p, headless):
        """يستخدم متصفح Edge (موجود بكل ويندوز) أو Chrome، فما نحتاج ننزل متصفح."""
        PROFILE_DIR.mkdir(exist_ok=True)
        last_err = None
        for channel in ("msedge", "chrome", None):
            try:
                return p.chromium.launch_persistent_context(
                    str(PROFILE_DIR),
                    channel=channel,
                    headless=headless,
                    viewport={"width": 1280, "height": 860},
                    locale="ar",
                )
            except Exception as e:
                last_err = e
        raise RuntimeError(f"ما كدرت أفتح المتصفح. نزّل Microsoft Edge أو Google Chrome.\n{last_err}")

    def latest_video_ids(self, page, user):
        page.goto(f"https://www.tiktok.com/@{user}", wait_until="domcontentloaded", timeout=45000)
        try:
            page.wait_for_selector('a[href*="/video/"]', timeout=20000)
        except PWTimeout:
            log.warning("@%s: ما لكيت فيديوهات (حساب خاص؟ كابتشا؟ أو الصفحة ما حملت)", user)
            return []
        hrefs = page.eval_on_selector_all('a[href*="/video/"]', "els => els.map(e => e.href)")
        ids = set()
        for h in hrefs:
            if f"/@{user}/" not in h.lower():
                continue
            m = VIDEO_ID_RE.search(h)
            if m:
                ids.add(int(m.group(1)))
        return sorted(ids, reverse=True)

    def engage(self, page, url, comment, cfg):
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        self.human_pause(4, 7)  # كأنك تشوف الفيديو شوية

        if cfg.get("do_like", True):
            btn = self.first_visible(page, SELECTORS["like"])
            if not btn:
                log.warning("  ما لكيت زر اللايك")
            elif self.is_pressed(btn):
                log.info("  لايك موجود مسبقاً")
            else:
                btn.click()
                log.info("  ✓ لايك")
            self.human_pause()

        if cfg.get("do_save", True):
            btn = self.first_visible(page, SELECTORS["save"])
            if not btn:
                log.warning("  ما لكيت زر الحفظ")
            elif self.is_pressed(btn):
                log.info("  محفوظ مسبقاً")
            else:
                btn.click()
                log.info("  ✓ حفظ")
            self.human_pause()

        if cfg.get("do_comment", True) and comment:
            box = self.first_visible(page, SELECTORS["comment_input"], timeout=12000)
            if not box:
                log.warning("  ما لكيت خانة التعليق (التعليقات مقفولة؟)")
                return
            box.click()
            self.human_pause(0.5, 1.2)
            page.keyboard.type(comment, delay=random.randint(60, 140))
            self.human_pause(0.8, 1.8)
            post = self.first_visible(page, SELECTORS["comment_post"], timeout=3000)
            if post:
                post.click()
            else:
                page.keyboard.press("Enter")
            log.info("  ✓ تعليق: %s", comment)
            self.human_pause(2, 4)

    # ---------- commands ----------

    def login(self):
        """
        يفتح Edge عادي (بدون أي تحكم آلي) على نفس بروفايل البوت.
        تيك توك يرفض تسجيل الدخول من المتصفح المتحكم بيه آلياً، فالدخول لازم يكون بمتصفح طبيعي،
        والكوكيز تنحفظ بالبروفايل ويستخدمها البوت بعدين.
        """
        browser = find_browser()
        if not browser:
            raise RuntimeError("ما لكيت متصفح Edge أو Chrome بالجهاز.")
        PROFILE_DIR.mkdir(exist_ok=True)
        proc = subprocess.Popen([
            browser, f"--user-data-dir={PROFILE_DIR}", "--no-first-run", "--no-default-browser-check",
            "--disable-background-mode", "--window-size=480,820",
            "--app=https://www.tiktok.com/login",
        ])
        log.info("سجل دخول بنافذة تيك توك اللي انفتحت (تكدر تستخدم QR من التطبيق بموبايلك).")
        log.info("لما تخلص وتشوف حسابك، سكّر نافذة تيك توك.")
        while proc.poll() is None:
            if self.stop_event.wait(0.5):
                proc.terminate()
                raise Stopped()
        time.sleep(1.5)  # نخلي المتصفح يكمل حفظ الكوكيز
        self.check_login()

    def check_login(self):
        """يتأكد من وجود جلسة تيك توك بالبروفايل."""
        with sync_playwright() as p:
            for attempt in range(5):
                try:
                    ctx = self.open_context(p, headless=True)
                    break
                except RuntimeError:
                    if attempt == 4:
                        raise
                    self.sleep(2)
            try:
                cookies = ctx.cookies("https://www.tiktok.com")
            finally:
                ctx.close()
        ok = any(c["name"] == "sessionid" and c["value"] for c in cookies)
        _atomic_write(LOGIN_FILE, {"logged_in": ok, "checked": int(time.time())})
        if ok:
            log.info("تم تسجيل الدخول وحفظ الجلسة ✓")
            return True
        log.warning("ما لكيت جلسة تسجيل دخول. دوس 🔑 تسجيل الدخول وسجل، وما تسكر المتصفح إلا بعد ما تشوف حسابك.")
        return False

    def test(self, url):
        cfg = load_config()
        if not self.check_login():
            return
        with sync_playwright() as p:
            ctx = self.open_context(p, headless=False)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            comment = (cfg.get("default_comments") or [None])[0]
            log.info("تجربة على: %s", url)
            try:
                self.engage(page, url, comment, cfg)
                log.info("خلصت التجربة ✓ — سكر المتصفح لما تخلص تشوف.")
                while ctx.pages and not self.stop_event.is_set():
                    time.sleep(0.5)
            finally:
                try:
                    ctx.close()
                except Exception:
                    pass

    def run(self):
        cfg = load_config()
        state = load_state()
        users = list(cfg["accounts"])
        if not users:
            log.warning("ما ضفت أي حساب للمراقبة.")
            return
        lo, hi = cfg.get("check_interval_minutes", [4, 8])
        max_per_hour = cfg.get("max_actions_per_hour", 10)
        recent_actions = deque()

        if not self.check_login():
            return
        log.info("المراقبة بدأت على %d حساب: %s", len(users), ", ".join("@" + u for u in users))

        with sync_playwright() as p:
            ctx = self.open_context(p, headless=cfg.get("headless", False))
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            try:
                while True:
                    random.shuffle(users)
                    for user in users:
                        self._check_user(page, user, cfg, state, recent_actions, max_per_hour)
                        self.human_pause(3, 8)
                    wait = random.uniform(lo, hi) * 60
                    log.info("دورة خلصت، الفحص الجاي بعد %.1f دقيقة", wait / 60)
                    self.sleep(wait)
            finally:
                try:
                    ctx.close()
                except Exception:
                    pass

    def _check_user(self, page, user, cfg, state, recent_actions, max_per_hour):
        try:
            ids = self.latest_video_ids(page, user)
        except Stopped:
            raise
        except Exception as e:
            log.warning("@%s: خطأ بالتحميل: %s", user, e)
            return
        if not ids:
            return

        last = state["last_id"].get(user)
        if last is None:
            # أول مرة: نسجل آخر فيديو بس، وما نعلق على القديم
            state["last_id"][user] = ids[0]
            save_state(state)
            log.info("@%s: تم التسجيل (آخر فيديو %s)", user, ids[0])
            return

        for vid in sorted(i for i in ids if i > last):  # الأقدم أولاً
            now = time.time()
            while recent_actions and now - recent_actions[0] > 3600:
                recent_actions.popleft()
            if len(recent_actions) >= max_per_hour:
                log.info("وصلنا الحد بالساعة (%d)، نأجل للدورة الجاية", max_per_hour)
                return

            url = f"https://www.tiktok.com/@{user}/video/{vid}"
            log.info("🆕 @%s نزل فيديو جديد: %s", user, url)
            comment = pick_comment(cfg, state, user)
            try:
                self.engage(page, url, comment, cfg)
            except Stopped:
                raise
            except Exception as e:
                log.warning("  فشل التفاعل: %s", e)
                continue
            recent_actions.append(time.time())
            state["last_id"][user] = max(state["last_id"][user], vid)
            save_state(state)
            self.human_pause(8, 20)


def setup_logging(*extra_handlers):
    """ينادى بعد use_account() حتى السجل ينحفظ بفولدر الحساب."""
    handlers = [logging.FileHandler(LOG_FILE, encoding="utf-8"), *extra_handlers]
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S",
                        handlers=handlers, force=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        print("الحسابات الموجودة:", ", ".join(list_accounts()) or "ماكو")
        sys.exit(0)
    use_account(sys.argv[1], create=True)
    _lock = AccountLock(ACCOUNT)  # لازم يبقى بمتغير حتى القفل يظل شغال
    if not _lock.acquire():
        sys.exit("هذا الحساب مفتوح بالبرنامج حالياً.")
    setup_logging(logging.StreamHandler())
    bot = Bot()
    arg = sys.argv[2]
    try:
        if arg == "login":
            bot.login()
        elif arg == "test" and len(sys.argv) > 3:
            bot.test(sys.argv[3])
        elif arg == "run":
            bot.run()
        else:
            print(__doc__)
    except (KeyboardInterrupt, Stopped):
        log.info("توقف.")
