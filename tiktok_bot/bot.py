"""
TikTok watcher: يراقب مجموعة حسابات، وأول ما ينزل فيديو جديد
يسوي لايك + حفظ + تعليق (تعليق مختلف لكل حساب).

الاستخدام:
    python bot.py login     # يفتح المتصفح حتى تسجل دخول لحسابك مرة وحدة
    python bot.py run       # يبدأ المراقبة
    python bot.py test URL  # يجرب لايك/حفظ/تعليق على فيديو معين
"""

import json
import logging
import random
import re
import sys
import time
from collections import deque
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

# لما يشتغل كـ exe، الملفات تنحفظ جنب الـ exe
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # حتى العربي ما يخرب بشاشة الويندوز
    except Exception:
        pass

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
    "accounts": {
        "username1": ["أول تعليق لهذا الحساب 🔥", "تعليق ثاني لهذا الحساب 👏"],
        "username2": ["كلش حلو ❤️", "ابداع 😍"],
    },
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(), logging.FileHandler(BASE / "bot.log", encoding="utf-8")],
)
log = logging.getLogger("bot")


# ---------- config / state ----------

def load_config():
    if not CONFIG_FILE.exists():
        CONFIG_FILE.write_text(json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nسويت ملف الإعدادات: {CONFIG_FILE}")
        print("افتحه بالمفكرة (Notepad) وحط أسماء الحسابات والتعليقات، وبعدين شغل البرنامج مرة ثانية.")
        pause_exit()
    cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    cfg["accounts"] = {u.lstrip("@").strip().lower(): c for u, c in cfg["accounts"].items()}
    return cfg


def pause_exit(code=0):
    input("\nدوس Enter للخروج...")
    sys.exit(code)


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

def human_pause(a=1.5, b=4.0):
    time.sleep(random.uniform(a, b))


def first_visible(page, keys, timeout=8000):
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
        time.sleep(0.4)
    return None


def is_pressed(loc):
    """يتأكد إذا اللايك/الحفظ مفعّل مسبقاً حتى ما نلغيه بالغلط."""
    try:
        return loc.evaluate(
            "el => { const b = el.closest('button') || el;"
            " return b.getAttribute('aria-pressed') === 'true'; }"
        )
    except Exception:
        return False


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
    log.error("ما كدرت أفتح المتصفح. نزّل Microsoft Edge أو Google Chrome.\n%s", last_err)
    pause_exit(1)


def latest_video_ids(page, user):
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


def engage(page, url, comment, cfg):
    page.goto(url, wait_until="domcontentloaded", timeout=45000)
    human_pause(4, 7)  # كأنك تشوف الفيديو شوية

    if cfg.get("do_like", True):
        btn = first_visible(page, SELECTORS["like"])
        if not btn:
            log.warning("  ما لكيت زر اللايك")
        elif is_pressed(btn):
            log.info("  لايك موجود مسبقاً")
        else:
            btn.click()
            log.info("  ✓ لايك")
        human_pause()

    if cfg.get("do_save", True):
        btn = first_visible(page, SELECTORS["save"])
        if not btn:
            log.warning("  ما لكيت زر الحفظ")
        elif is_pressed(btn):
            log.info("  محفوظ مسبقاً")
        else:
            btn.click()
            log.info("  ✓ حفظ")
        human_pause()

    if cfg.get("do_comment", True) and comment:
        box = first_visible(page, SELECTORS["comment_input"], timeout=12000)
        if not box:
            log.warning("  ما لكيت خانة التعليق (التعليقات مقفولة؟)")
            return
        box.click()
        human_pause(0.5, 1.2)
        page.keyboard.type(comment, delay=random.randint(60, 140))
        human_pause(0.8, 1.8)
        post = first_visible(page, SELECTORS["comment_post"], timeout=3000)
        if post:
            post.click()
        else:
            page.keyboard.press("Enter")
        log.info("  ✓ تعليق: %s", comment)
        human_pause(2, 4)


# ---------- commands ----------

def cmd_login():
    with sync_playwright() as p:
        ctx = open_context(p, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.tiktok.com/login")
        print("\nسجل دخول لحسابك بالمتصفح اللي انفتح، وبعدين ارجع هنا ودوس Enter...")
        input()
        ctx.close()
    print("تم حفظ الجلسة. هسه شغل:  python bot.py run")


def cmd_test(url):
    cfg = load_config()
    with sync_playwright() as p:
        ctx = open_context(p, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        comment = (cfg.get("default_comments") or [None])[0]
        engage(page, url, comment, cfg)
        input("خلص الاختبار. دوس Enter حتى يتسكر المتصفح...")
        ctx.close()


def cmd_run():
    cfg = load_config()
    state = load_state()
    users = list(cfg["accounts"])
    lo, hi = cfg.get("check_interval_minutes", [4, 8])
    max_per_hour = cfg.get("max_actions_per_hour", 10)
    recent_actions = deque()

    log.info("المراقبة بدأت على %d حساب: %s", len(users), ", ".join("@" + u for u in users))

    with sync_playwright() as p:
        ctx = open_context(p, headless=cfg.get("headless", False))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        while True:
            random.shuffle(users)
            for user in users:
                try:
                    ids = latest_video_ids(page, user)
                except Exception as e:
                    log.warning("@%s: خطأ بالتحميل: %s", user, e)
                    continue
                if not ids:
                    continue

                last = state["last_id"].get(user)
                if last is None:
                    # أول مرة: نسجل آخر فيديو بس، وما نعلق على القديم
                    state["last_id"][user] = ids[0]
                    save_state(state)
                    log.info("@%s: تم التسجيل (آخر فيديو %s)", user, ids[0])
                    human_pause(3, 6)
                    continue

                new_ids = sorted(i for i in ids if i > last)  # الأقدم أولاً
                for vid in new_ids:
                    now = time.time()
                    while recent_actions and now - recent_actions[0] > 3600:
                        recent_actions.popleft()
                    if len(recent_actions) >= max_per_hour:
                        log.info("وصلنا الحد بالساعة (%d)، نأجل للدورة الجاية", max_per_hour)
                        break

                    url = f"https://www.tiktok.com/@{user}/video/{vid}"
                    log.info("🆕 @%s نزل فيديو جديد: %s", user, url)
                    comment = pick_comment(cfg, state, user)
                    try:
                        engage(page, url, comment, cfg)
                    except Exception as e:
                        log.warning("  فشل التفاعل: %s", e)
                        continue
                    recent_actions.append(time.time())
                    state["last_id"][user] = max(state["last_id"][user], vid)
                    save_state(state)
                    human_pause(8, 20)

                human_pause(3, 8)

            wait = random.uniform(lo, hi) * 60
            log.info("دورة خلصت، الفحص الجاي بعد %.1f دقيقة", wait / 60)
            time.sleep(wait)


def menu():
    print("=" * 40)
    print("      TikTok Bot  - لايك + حفظ + تعليق")
    print("=" * 40)
    print("1) تسجيل الدخول لحسابك (أول مرة)")
    print("2) تشغيل المراقبة")
    print("3) تجربة على فيديو واحد")
    print("4) فتح ملف الإعدادات")
    choice = input("\nاختار رقم: ").strip()
    if choice == "1":
        return ["login"]
    if choice == "2":
        return ["run"]
    if choice == "3":
        return ["test", input("الصق رابط الفيديو: ").strip()]
    if choice == "4":
        load_config()
        import os
        os.startfile(CONFIG_FILE) if hasattr(os, "startfile") else print(CONFIG_FILE)
        sys.exit(0)
    return []


if __name__ == "__main__":
    argv = sys.argv[1:] or menu()
    arg = argv[0] if argv else ""
    sys.argv = [sys.argv[0]] + argv
    try:
        if arg == "login":
            cmd_login()
        elif arg == "test" and len(sys.argv) > 2:
            cmd_test(sys.argv[2])
        elif arg == "run":
            cmd_run()
        else:
            print(__doc__)
    except KeyboardInterrupt:
        log.info("توقف.")
    except Exception:
        log.exception("صار خطأ:")
        pause_exit(1)
