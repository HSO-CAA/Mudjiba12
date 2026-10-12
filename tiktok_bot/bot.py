"""
محرك البوت: يراقب مجموعة حسابات تيك توك، وأول ما ينزل فيديو جديد
يسوي لايك + حفظ + تعليق (تعليق مختلف لكل حساب).

الواجهة موجودة بـ app.py. هذا الملف يشتغل بدونها أيضاً:
    python bot.py login     # يفتح المتصفح حتى تسجل دخول، سكره لما تخلص
    python bot.py run       # يبدأ المراقبة
    python bot.py test URL  # يجرب لايك/حفظ/تعليق على فيديو معين
"""

import json
import logging
import random
import re
import sys
import threading
import time
from collections import deque
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

# لما يشتغل كـ exe، الملفات تنحفظ جنب الـ exe
BASE = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
CONFIG_FILE = BASE / "config.json"
STATE_FILE = BASE / "state.json"
PROFILE_DIR = BASE / "profile"

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


class Stopped(Exception):
    """ينرمي لما المستخدم يدوس إيقاف."""


# ---------- config / state ----------

def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        cfg.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
    cfg["accounts"] = {clean_user(u): c for u, c in cfg["accounts"].items() if clean_user(u)}
    return cfg


def save_config(cfg):
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def clean_user(u):
    return u.strip().lstrip("@").strip().lower()


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"last_id": {}, "used_comments": {}}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


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
        """يفتح صفحة الدخول ويستنى لحد ما تسكر المتصفح أو تدوس إيقاف."""
        with sync_playwright() as p:
            ctx = self.open_context(p, headless=False)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto("https://www.tiktok.com/login")
            log.info("سجل دخول بالمتصفح، ولما تخلص سكر المتصفح.")
            try:
                while ctx.pages and not self.stop_event.is_set():
                    time.sleep(0.5)
            finally:
                try:
                    ctx.close()
                except Exception:
                    pass
        log.info("تم حفظ الجلسة ✓")

    def test(self, url):
        cfg = load_config()
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
    handlers = [logging.FileHandler(BASE / "bot.log", encoding="utf-8"), *extra_handlers]
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S",
                        handlers=handlers, force=True)


if __name__ == "__main__":
    setup_logging(logging.StreamHandler())
    bot = Bot()
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if arg == "login":
            bot.login()
        elif arg == "test" and len(sys.argv) > 2:
            bot.test(sys.argv[2])
        elif arg == "run":
            bot.run()
        else:
            print(__doc__)
    except (KeyboardInterrupt, Stopped):
        log.info("توقف.")
