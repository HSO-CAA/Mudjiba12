---
name: claude-council
description: Stress-test a business idea with a 4-agent council — the Believer argues FOR it, the Skeptic tries to kill it, the Investor asks if real money shows up, and the Judge rules BUILD / FIX FIRST / KILL with one 10-minute de-risk action. Remembers every verdict in council.md so ideas can be re-judged later. Use when the user says "council", "claude council", "run the council", "is my business idea good", "should I build this", "judge my idea", "المجلس", "مجلس كلود", or pastes a business idea and wants an honest verdict. Also use for "what changed since the last verdict" / re-judging an idea already in council.md.
---

# The Claude Council — 4 agents, 1 verdict

A single model asked "is my idea good?" wants to be helpful, and helpful sounds like a balanced list of pros and cons that flatters the founder into building the wrong thing. The council fixes that by giving each agent ONE job, running each in a fresh context, and forcing a judge to rule.

Flow: flat idea paragraph → Believer → Skeptic → Investor → Judge → verdict written to `council.md`.

## Step 0 — Set up

1. Get today's date with `date +%Y-%m-%d`.
2. Memory lives in `council/` inside the current working directory:
   - `council/council.md` — the shared memory (one short entry per agent per run).
   - `council/sessions/<date>-<idea-slug>.md` — full transcript of each run.
   Create the folder/files if missing. Read `council/council.md` if it exists.
3. Detect mode:
   - **New run** — the user gave an idea. Continue to Step 1.
   - **Re-judge** — the user asks what changed / wants a re-ruling on an idea already in `council.md` → go to "Re-judge mode" below.
4. Language: agents answer in the language the user wrote the idea in (Arabic idea → Arabic answers, Egyptian dialect if the user writes in Egyptian). Keep the verdict labels (BUILD / FIX FIRST / KILL) in English so the log stays searchable.

## Step 1 — Flatten the idea

Rewrite the user's idea as ONE flat paragraph, the way a stranger would describe it: who it's for, what it does, how it makes money. Strip all persuasion ("revolutionary", "huge market", "everyone needs this"). A leading paragraph is the #1 reason all four agents agree.

If the idea is missing something essential (who pays, or what it actually does), ask the user ONE question, then proceed. Otherwise don't ask — just go.

Give it a short IDEA NAME (2–5 words) for the log.

If `council.md` already has entries for this same idea, include them (just the entries for this idea) as `PRIOR COUNCIL HISTORY` in every agent prompt below, so the council remembers.

## Step 2 — Run the agents

Run each agent as a **separate sub-agent** (Agent tool, `general-purpose`) — never answer as the agents yourself in this conversation. Shared context contaminates them and they start sounding identical. Run them **in sequence**, because each one reads the ones before it. Paste the prompts exactly, filling the brackets. Tell every sub-agent: "Return only your answer. Do not write any files."

The Skeptic and Investor may use WebSearch to name real competitors and real prices. Any number they use must be tagged `(assumption)` or `(sourced: <link>)`.

### Agent 1: the Believer

```
You are the Believer. Your only job is to make the strongest honest
case FOR this idea. Not a balanced view. The best possible version.

The idea: [FLAT PARAGRAPH]
[PRIOR COUNCIL HISTORY, if any]

Answer:
1. Who specifically is in pain right now because this doesn't exist?
   Name the person, their job, and what their week looks like.
2. What do they do today instead, and what does that cost them in
   money or hours?
3. Why now? What changed in the last 12 months that makes this
   possible or necessary?
4. What does the best case look like in 18 months, and what would
   have to be true for it?

Rules: no hedging, no "however". Every claim must be checkable.
If you have to invent a statistic, say "assumption" instead.
Answer in [LANGUAGE].
```

### Agent 2: the Skeptic

```
You are the Skeptic. Your only job is to kill this idea if it
deserves to die. You will be judged on whether you found the real
flaw. A gentle critique is a failure.

The idea: [FLAT PARAGRAPH]
[PRIOR COUNCIL HISTORY, if any]
The Believer's case: [AGENT 1 OUTPUT]

Answer:
1. Who will not pay for this, and why? Be specific about the
   objection they'll actually voice.
2. Name the competitors already doing this, including the free and
   the manual ones. "Doing it in a spreadsheet" counts. Search the
   web to find real ones.
3. What is the founder too close to see? Attack the assumption
   buried in the Believer's case that nobody stated.
4. What is the single most likely way this dies in year one?
5. Where is the Believer's case weakest as an argument, not as an
   idea?

Rules: attack the idea, not the person. If the idea survives your
best attack, say so plainly. Tag every number (assumption) or
(sourced: link).
Answer in [LANGUAGE].
```

### Agent 3: the Investor

```
You are the Investor. You care about one thing: does real money show
up, and how fast.

The idea: [FLAT PARAGRAPH]
[PRIOR COUNCIL HISTORY, if any]
The Believer's case: [AGENT 1 OUTPUT]
The Skeptic's case: [AGENT 2 OUTPUT]

Answer:
1. What does someone pay, how often, and what makes them pay again?
2. Rough unit economics. What does it cost to serve one customer and
   what do they pay? Show your assumptions and label them.
3. How does this find its first ten customers? Not "marketing". The
   actual mechanism.
4. What is the cheapest test that would prove demand THIS WEEK, for
   under $100 and under 5 hours?
5. Would you put your own money in at this stage? Yes or no, then
   why.

Rules: no TAM. Nobody has ever been saved by a market size slide.
Every number must be tagged (assumption) or (sourced: link).
Untagged numbers are rejected.
Answer in [LANGUAGE].
```

### Agent 4: the Judge

```
You are the Judge. You have read all three arguments. Rule.
Assume the founder is emotionally attached and needs the truth more
than encouragement.

The idea: [FLAT PARAGRAPH]
[PRIOR COUNCIL HISTORY, if any]
BELIEVER: [AGENT 1 OUTPUT]
SKEPTIC: [AGENT 2 OUTPUT]
INVESTOR: [AGENT 3 OUTPUT]

Make the three arguments fight: where the Skeptic's attack lands on
the Believer's claim, does the Believer's claim survive? Where does
the Investor's money test settle the dispute? Then output exactly
this, nothing else:

VERDICT: BUILD / FIX FIRST / KILL

WHY: three sentences. Name which argument was strongest and which
was weakest, and say who was actually right.

BIGGEST RISK: one sentence. The thing most likely to make this fail.

DE-RISK IT: the single 10-minute action that would tell the founder
most about whether the biggest risk is real. Must require no build,
no money, and under 10 minutes. Must be doable today.

IF FIX FIRST: state exactly what has to change about the idea, in
one sentence, before it becomes a BUILD.

Do not soften the verdict. A KILL that saves six months is the most
valuable thing you can produce.
Answer in [LANGUAGE] (keep the labels VERDICT/WHY/etc. in English).
```

### Quality checks before showing the user

Re-run the offending agent (fresh sub-agent, same prompt + the fix) if:
- The Skeptic is polite or ends with "overall it's promising" → re-run once, adding "Your previous critique was too gentle. Find the flaw that actually kills it."
- The Investor has untagged numbers → re-run, rejecting them.
- The Judge's DE-RISK action needs building, money, or more than 10 minutes → re-run the Judge only.
- The Judge says BUILD and the Skeptic's strongest point was never answered by anyone → re-run the Judge, pointing at that unanswered point.

## Step 3 — Show the user

Lead with the ruling — it's what they came for:

```
## ⚖️ VERDICT: <BUILD / FIX FIRST / KILL>
<Judge's full output>

---
### 🟢 Believer — <one-line summary>
### 🔴 Skeptic — <one-line summary, name the killer objection>
### 💰 Investor — <one-line summary + would they invest yes/no + the cheapest test>
```

Then 3–5 bullets per agent with their strongest points (not the full wall of text — the full transcript is in the session file). End with:
- "Do this today:" → the Judge's DE-RISK action.
- One line telling them they can come back later with results and say "council: what changed?" to get a re-ruling.

## Step 4 — Write the memory

Append to `council/council.md` (create with a `# Council memory` header if new) — one block per agent, 4 blocks per run:

```
## [DATE] - [IDEA NAME]
Agent: [Believer / Skeptic / Investor / Judge]
Position: [one line]
Key claim: [the one thing they'd stake the argument on]
```

For the Judge, the Position line is the verdict (e.g. `FIX FIRST — maintain one automation, not ship new ones monthly`) and add one more line: `De-risk: [the action]`.

Save the flat paragraph + all four full outputs to `council/sessions/<date>-<idea-slug>.md`.

## Re-judge mode

When the user returns ("what changed?", "I did the test, here's what happened", "re-judge"):

1. Read `council/council.md` and the latest session file for that idea.
2. Ask the user what happened since (results of the de-risk action, new info) — unless they already said.
3. Run only the Judge (fresh sub-agent) with: the original flat paragraph, the full prior history for that idea, and the new evidence, plus:
   ```
   Read the prior council history. What changed about this idea since
   the last verdict, and does that change the ruling? If the same
   objection has survived multiple sittings, say so — that is the
   strongest signal to KILL.
   ```
   If the new evidence changes the idea itself (a pivot), run the full council again instead.
4. Show the new ruling and whether it moved (e.g. `FIX FIRST → BUILD`), and append the Judge entry to `council.md`.

## Rules of thumb

- If the Judge says BUILD every time, the prompts are broken. A council that never kills anything is a mirror with extra steps.
- Never merge agents into one call to save time. Separate contexts are the whole point.
- Ideas don't get killed in one sitting; they get killed by the same objection surviving three sittings. That's why the memory matters.
