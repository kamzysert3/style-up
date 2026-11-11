# StyleUp

Snap a photo of your outfit, get an honest 0–100 score with specific, garment-level feedback
and one concrete swap that would improve it.

This is **Milestone 1: outfit scoring only**. No wardrobe scanning, no swaps, no try-on yet —
those wait until the score itself is trusted. See `PRODUCT.md` for the product framing and
`.opencode/plan/m1-outfit-scoring.md` in the second-brain vault for the full plan.

## Architecture

```
Expo app (phone)  ──POST /score {image: base64}──▶  local / Cloudflare proxy  ──▶  Gemini (vision)
  │                                                    (holds GEMINI_API_KEY)
  └── photo + score stored on-device (expo-sqlite)
```

- The **API key lives only in the proxy**, never in the app bundle.
- The **photo never leaves your proxy → Gemini path**; scores and photos stay on the device.
- The proxy is a small Hono app (`proxy/`) that runs locally on Node and deploys unchanged
  to Cloudflare Workers later.

### All-local alternative: `proxy/styleup-proxy-qwen3vl.ipynb`

Same proxy, no API key and no network: a Jupyter notebook that serves the identical `/health` and
`/score` API from **Qwen3-VL running locally** on your own GPU, and downloads the weights for you
into `proxy/models/`. Open it, run the cells top to bottom, and point the app at it exactly as
below. Use it when you want free, offline, private scoring; use the Node proxy when you want
hosted-model quality and a Cloudflare deploy. Details, VRAM sizing, and the parity notes are in the
notebook.

## Setup

```bash
npm install
cp .env.example .env        # then paste your Google AI Studio key into GEMINI_API_KEY
npm run proxy               # starts http://localhost:8787
```

Optional `.env` overrides: `GEMINI_MODEL` (default `gemini-3.8-flash`),
`GEMINI_FALLBACK_MODELS` (default `gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite`),
`GEMINI_TIMEOUT_MS` (default 20000), `GEMINI_HEDGE_MS` (default 4000), `GEMINI_TEMPERATURE`
(default 0), `GEMINI_SAMPLES` (default 1), `PORT` (default 8787).

Scores are made as repeatable as the model allows: temperature is 0, and the response is
schema-constrained so the model describes the outfit and fills the sub-scores before it commits
to the overall number. Set `GEMINI_SAMPLES=3` to score each photo three times and keep the
median run (three times the quota). A response with a missing or out-of-range score is never
patched up with a default: the proxy retries that model once, moves to the next, and otherwise
returns an error.

**Access token.** Set `PROXY_TOKEN` in `.env` and `/score` only answers requests that carry it
(`Authorization: Bearer …`); enter the same value in the app under **Settings**. Leave it unset
only while the proxy is reachable from your own LAN and nowhere else. It is required before
any public deploy, or anyone with the URL can spend your Gemini quota.

A photo with no outfit in it is refused (`422`) rather than scored as 0.

The free tier's newest Flash models are heavily contested, so `/score` **hedges** across the
chain: the primary starts, and if it hasn't answered within `GEMINI_HEDGE_MS` — or fails
outright (503/429) — the next model is launched alongside it. The first valid score wins and
the losers are aborted. Measured: a saturated primary that used to cost 34–43s now lands in
~5s, at the cost of an occasional extra call.

The result screen records which model actually answered (`Scored by …`) and says so when it
was a fallback. Model choice *does*
move the number — the same photo scored 75/73 on one model and 88 on another — so during
calibration, pin one model (`GEMINI_MODEL`, empty `GEMINI_FALLBACK_MODELS`) if you want a
perfectly stable scale, or leave the hedge on for availability and discount the fallback-scored
outliers.

## Run the app

```bash
npm start                   # then scan the QR with Expo Go
```

Point the app at your proxy the first time you run it:

- **iOS simulator** — `http://localhost:8787` (the default)
- **Android emulator** — `http://10.0.2.2:8787`
- **Physical phone** — `http://<your-computer-LAN-IP>:8787` (find it with `ipconfig`); the
  phone and computer must be on the same Wi-Fi. Set it in the app under **Settings → Scoring
  server → Save & test**.

## Using it

1. Open the app — the camera is the home screen. Frame the full outfit, head to toe.
2. Shoot (or tap the gallery icon to use an existing photo).
3. Pick what you're **dressing for** (Everyday, Work, Evening out, Formal, Active) and tap
   **Score this outfit**. You'll get a 0–100 score for that occasion, five subscores, what
   works, and 2–3 concrete improvements.
4. Add **your own score** at the bottom of the result. History then shows how often the model
   lands within ±5 of you, which is the M1 acceptance number.
5. Every score is saved to **History** (tap the clock icon). Long-press a tile to delete it.

## Checks

```bash
npx tsc --noEmit            # typecheck
npx expo lint               # lint
```

## Calibration (the part that earns trust)

The score is only worth something if you agree with it. The rubric lives in
`proxy/src/rubric.ts` and the plan is:

1. Score 15–20 real outfits you already own and have opinions about.
2. Note where you disagree by more than ±5 points.
3. Add the clearest disagreements as anchors in `REFERENCE_EXAMPLES` in
   `proxy/src/rubric.ts` (description + the score you believe it deserves), and/or tighten the
   band descriptions in `RUBRIC_PROMPT`.
4. Re-score a few outfits and confirm the fix holds. Repeat until you agree on ≥16/20.

Acceptance criteria for M1: agreement within ±5 on ≥16 of 20 real outfits, score latency
under ~10s, history surviving restarts, and no API key in the app binary.

## Layout

```
src/
  app/            Expo Router routes: index (camera) · score · history · settings
  components/     Shared UI (buttons, top bar)
  lib/            db (SQLite) · image (resize/compress/persist) · scoring (proxy client) · settings
  theme.ts        Design tokens — colors, spacing, type scale, score bands
proxy/
  src/            Hono app: /health · /score · rubric prompt · Gemini client
  styleup-proxy-qwen3vl.ipynb   same API, Qwen3-VL running locally (downloads its own weights)
```

Run commands before declaring any task done: `npx tsc --noEmit` and `npx expo lint`.
