"""واجهة TikTok Bot — كل الإعدادات والتشغيل من نافذة وحدة."""

import logging
import queue
import threading
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

import bot

FONT = ("Segoe UI", 10)
FONT_BOLD = ("Segoe UI", 10, "bold")


class QueueHandler(logging.Handler):
    def __init__(self, q):
        super().__init__()
        self.q = q

    def emit(self, record):
        self.q.put(self.format(record))


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("TikTok Bot — لايك + حفظ + تعليق")
        self.geometry("900x720")
        self.minsize(760, 600)
        self.option_add("*Font", FONT)

        self.cfg = bot.load_config()
        self.accounts = {u: list(c) for u, c in self.cfg["accounts"].items()}
        self.current = None
        self.worker = None
        self.stop_event = threading.Event()
        self.log_q = queue.Queue()

        handler = QueueHandler(self.log_q)
        handler.setFormatter(logging.Formatter("%(asctime)s  %(message)s", "%H:%M:%S"))
        bot.setup_logging(handler)

        self._build()
        self._refresh_accounts()
        self.after(150, self._drain_log)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---------- layout ----------

    def _build(self):
        pad = {"padx": 8, "pady": 4}

        top = ttk.Frame(self)
        top.pack(fill="both", expand=True, **pad)
        top.columnconfigure(0, weight=2)
        top.columnconfigure(1, weight=1)
        top.rowconfigure(0, weight=1)

        # يمين: الحسابات
        acc = ttk.LabelFrame(top, text=" الحسابات اللي نراقبها ")
        acc.grid(row=0, column=1, sticky="nsew", padx=(6, 0))
        self.acc_list = tk.Listbox(acc, exportselection=False, justify="right", activestyle="none")
        self.acc_list.pack(fill="both", expand=True, padx=6, pady=6)
        self.acc_list.bind("<<ListboxSelect>>", lambda e: self._select_account())
        btns = ttk.Frame(acc)
        btns.pack(fill="x", padx=6, pady=(0, 6))
        ttk.Button(btns, text="➕ إضافة حساب", command=self._add_account).pack(side="right", expand=True, fill="x")
        ttk.Button(btns, text="🗑 حذف", command=self._remove_account).pack(side="right", expand=True, fill="x")

        # يسار: التعليقات
        com = ttk.Frame(top)
        com.grid(row=0, column=0, sticky="nsew")
        com.rowconfigure(1, weight=1)
        com.rowconfigure(3, weight=1)
        com.columnconfigure(0, weight=1)

        self.acc_label = ttk.Label(com, text="تعليقات الحساب (كل سطر تعليق)", font=FONT_BOLD, anchor="e")
        self.acc_label.grid(row=0, column=0, sticky="ew")
        self.acc_text = tk.Text(com, height=8, wrap="word")
        self.acc_text.tag_configure("rtl", justify="right")
        self.acc_text.grid(row=1, column=0, sticky="nsew", pady=(2, 8))

        ttk.Label(com, text="تعليقات عامة (للحسابات اللي ما إلها تعليقات)", font=FONT_BOLD, anchor="e")\
            .grid(row=2, column=0, sticky="ew")
        self.def_text = tk.Text(com, height=5, wrap="word")
        self.def_text.tag_configure("rtl", justify="right")
        self.def_text.grid(row=3, column=0, sticky="nsew", pady=2)
        self._set_text(self.def_text, self.cfg.get("default_comments", []))

        # الإعدادات
        st = ttk.LabelFrame(self, text=" الإعدادات ")
        st.pack(fill="x", **pad)
        lo, hi = self.cfg.get("check_interval_minutes", [4, 8])
        self.v_lo = tk.IntVar(value=lo)
        self.v_hi = tk.IntVar(value=hi)
        self.v_max = tk.IntVar(value=self.cfg.get("max_actions_per_hour", 10))
        self.v_like = tk.BooleanVar(value=self.cfg.get("do_like", True))
        self.v_save = tk.BooleanVar(value=self.cfg.get("do_save", True))
        self.v_comment = tk.BooleanVar(value=self.cfg.get("do_comment", True))
        self.v_headless = tk.BooleanVar(value=self.cfg.get("headless", False))

        row1 = ttk.Frame(st)
        row1.pack(fill="x", padx=6, pady=4)
        ttk.Label(row1, text="افحص كل").pack(side="right")
        ttk.Spinbox(row1, from_=1, to=120, width=4, textvariable=self.v_lo).pack(side="right", padx=3)
        ttk.Label(row1, text="إلى").pack(side="right")
        ttk.Spinbox(row1, from_=1, to=180, width=4, textvariable=self.v_hi).pack(side="right", padx=3)
        ttk.Label(row1, text="دقيقة      أقصى عدد فيديوهات بالساعة:").pack(side="right")
        ttk.Spinbox(row1, from_=1, to=100, width=4, textvariable=self.v_max).pack(side="right", padx=3)

        row2 = ttk.Frame(st)
        row2.pack(fill="x", padx=6, pady=4)
        for text, var in (("لايك ❤", self.v_like), ("حفظ 🔖", self.v_save),
                          ("تعليق 💬", self.v_comment), ("متصفح مخفي", self.v_headless)):
            ttk.Checkbutton(row2, text=text, variable=var).pack(side="right", padx=10)

        # الأزرار
        bar = ttk.Frame(self)
        bar.pack(fill="x", **pad)
        self.b_start = ttk.Button(bar, text="▶ تشغيل المراقبة", command=self._start)
        self.b_stop = ttk.Button(bar, text="■ إيقاف", command=self._stop, state="disabled")
        self.b_login = ttk.Button(bar, text="🔑 تسجيل الدخول", command=self._login)
        self.b_test = ttk.Button(bar, text="🧪 تجربة على فيديو", command=self._test)
        self.b_save = ttk.Button(bar, text="💾 حفظ الإعدادات", command=self._save)
        for b in (self.b_start, self.b_stop, self.b_login, self.b_test, self.b_save):
            b.pack(side="right", padx=3, ipady=4)
        self.status = ttk.Label(bar, text="⚪ متوقف", font=FONT_BOLD)
        self.status.pack(side="left", padx=6)

        # السجل
        lg = ttk.LabelFrame(self, text=" السجل ")
        lg.pack(fill="both", expand=True, **pad)
        self.log_text = tk.Text(lg, height=10, state="disabled", wrap="word", bg="#111", fg="#ddd")
        self.log_text.tag_configure("rtl", justify="right")
        sb = ttk.Scrollbar(lg, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=sb.set)
        sb.pack(side="left", fill="y")
        self.log_text.pack(fill="both", expand=True, padx=4, pady=4)

    # ---------- helpers ----------

    @staticmethod
    def _set_text(widget, lines):
        widget.delete("1.0", "end")
        widget.insert("1.0", "\n".join(lines), "rtl")

    @staticmethod
    def _get_lines(widget):
        return [l.strip() for l in widget.get("1.0", "end").splitlines() if l.strip()]

    def _store_current(self):
        if self.current is not None and self.current in self.accounts:
            self.accounts[self.current] = self._get_lines(self.acc_text)

    def _refresh_accounts(self, select=None):
        self.acc_list.delete(0, "end")
        names = list(self.accounts)
        for u in names:
            self.acc_list.insert("end", "@" + u)
        if select in names:
            idx = names.index(select)
        elif names:
            idx = 0
        else:
            self.current = None
            self.acc_label.config(text="ضيف حساب من اليمين ←")
            self._set_text(self.acc_text, [])
            return
        self.acc_list.selection_clear(0, "end")
        self.acc_list.selection_set(idx)
        self._select_account()

    def _select_account(self):
        sel = self.acc_list.curselection()
        if not sel:
            return
        self._store_current()
        self.current = list(self.accounts)[sel[0]]
        self.acc_label.config(text=f"تعليقات @{self.current} (كل سطر تعليق)")
        self._set_text(self.acc_text, self.accounts[self.current])

    def _add_account(self):
        name = simpledialog.askstring("إضافة حساب", "اسم الحساب (مثلاً: username أو @username):", parent=self)
        if not name:
            return
        self._store_current()
        last = None
        for u in name.replace(",", " ").split():
            u = bot.clean_user(u)
            if u and u not in self.accounts:
                self.accounts[u] = []
                last = u
        self._refresh_accounts(select=last)

    def _remove_account(self):
        if self.current and messagebox.askyesno("حذف", f"تحذف @{self.current}؟", parent=self):
            self.accounts.pop(self.current, None)
            self.current = None
            self._refresh_accounts()

    def _save(self, quiet=False):
        self._store_current()
        try:
            lo, hi = sorted((int(self.v_lo.get()), int(self.v_hi.get())))
            mx = int(self.v_max.get())
        except (tk.TclError, ValueError):
            messagebox.showerror("خطأ", "الأرقام بالإعدادات لازم تكون أرقام صحيحة.", parent=self)
            return False
        self.cfg.update({
            "check_interval_minutes": [max(1, lo), max(1, hi)],
            "max_actions_per_hour": max(1, mx),
            "do_like": self.v_like.get(),
            "do_save": self.v_save.get(),
            "do_comment": self.v_comment.get(),
            "headless": self.v_headless.get(),
            "default_comments": self._get_lines(self.def_text),
            "accounts": self.accounts,
        })
        bot.save_config(self.cfg)
        if not quiet:
            logging.getLogger("bot").info("تم حفظ الإعدادات ✓")
        return True

    def _drain_log(self):
        try:
            while True:
                line = self.log_q.get_nowait()
                self.log_text.configure(state="normal")
                self.log_text.insert("end", line + "\n", "rtl")
                self.log_text.see("end")
                self.log_text.configure(state="disabled")
        except queue.Empty:
            pass
        self.after(150, self._drain_log)

    # ---------- actions ----------

    def _launch(self, label, fn, *args):
        if self.worker and self.worker.is_alive():
            return
        if not self._save(quiet=True):
            return
        self.stop_event = threading.Event()
        runner = bot.Bot(self.stop_event)

        def target():
            try:
                getattr(runner, fn)(*args)
            except bot.Stopped:
                logging.getLogger("bot").info("توقف.")
            except Exception as e:
                logging.getLogger("bot").error("صار خطأ: %s", e)
            finally:
                self.after(0, self._idle)

        self.worker = threading.Thread(target=target, daemon=True)
        self.worker.start()
        self.status.config(text=label)
        for b in (self.b_start, self.b_login, self.b_test):
            b.config(state="disabled")
        self.b_stop.config(state="normal")

    def _idle(self):
        self.status.config(text="⚪ متوقف")
        for b in (self.b_start, self.b_login, self.b_test):
            b.config(state="normal")
        self.b_stop.config(state="disabled")

    def _start(self):
        self._store_current()
        if not self.accounts:
            messagebox.showwarning("ماكو حسابات", "ضيف حساب واحد على الأقل.", parent=self)
            return
        self._launch("🟢 يراقب...", "run")

    def _login(self):
        messagebox.showinfo("تسجيل الدخول",
                            "راح ينفتح المتصفح. سجل دخول لحسابك بتيك توك، ولما تخلص سكّر المتصفح.",
                            parent=self)
        self._launch("🔑 تسجيل الدخول...", "login")

    def _test(self):
        url = simpledialog.askstring("تجربة", "الصق رابط فيديو تيك توك:", parent=self)
        if url and "tiktok.com" in url:
            self._launch("🧪 تجربة...", "test", url.strip())
        elif url:
            messagebox.showerror("خطأ", "هذا مو رابط تيك توك.", parent=self)

    def _stop(self):
        self.stop_event.set()
        self.status.config(text="⏳ يوقف...")

    def _on_close(self):
        self._store_current()
        self._save(quiet=True)
        self.stop_event.set()
        self.destroy()


if __name__ == "__main__":
    try:
        App().mainloop()
    except Exception as e:  # بدون شاشة سودة، فنطلع الخطأ بنافذة
        messagebox.showerror("TikTok Bot", f"صار خطأ:\n{e}")
        raise
