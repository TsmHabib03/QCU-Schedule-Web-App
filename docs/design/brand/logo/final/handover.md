# QCU Schedule — Logo Handover

**Direction:** A — *Q Hour*. **Round:** 1 (approved from the concept checkpoint).

## Rationale
The mark fuses the two things that matter: **QCU** (the Q) and **time / "now"** (the Q's counter reads as a clock face; its tail is the hand). It carries equity from the previous Q-and-hand icon but resolves it into one clean, flat, institutional form that matches the product's own `.impeccable.md` voice — calm, truthful, a public-service status board. Blue + gold reads as QCU; flag red stays reserved for alerts.

## What's in the kit (`brand/logo/final/`)
- **Masters:** `final-symbol.svg` (one-colour), `final-symbol-color.svg` (blue/gold), `final-symbol-small.svg` (bold ≤32 px cut), `final-symbol-reversed.svg`.
- **Lockups:** `final-horizontal.svg`, `final-stacked.svg`, `final-endorsement.svg` (centered, with the QCU + QC Government seals).
- **One-colour variants:** `*-black.svg`, `*-white.svg`, `*-mono-005bac.svg` for symbol and horizontal.
- **Web icons:** `favicon.ico`, `favicon.svg`, `favicon-16/32/48.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `maskable-512.png`, `site.webmanifest`, `head-snippet.html`.
- **Docs & presentation:** `brand-guidelines.md`, `presentation.html` + `slides/`, `preview.html`.

## Test results
- `svg_audit`: symbol masters **100/100**, path-only, one colour, square, centred.
- Scale ladder + pixel test (`preview.html`): silhouette holds 16 → 256 px; the bold small cut is used ≤32 px.
- App-icon / favicon: white mark on QCU Blue reads cleanly at 16 px (`apple-touch-icon.png`, `icon-512.png`).
- Mirror / rotate / squint: no unintended readings; reads as a Q + clock hand.

## Open items (do before shipping)
1. **Outline the wordmark.** The lockup SVGs (`final-horizontal`, `final-stacked`, `final-endorsement`) contain **live Public Sans text** so they stay editable. Before external distribution, open each in a vector editor with Public Sans installed and convert text → outlines (Public Sans is SIL OFL, cleared for logo use). The symbol masters have **no** live text and are final as-is. *(I can produce outlined versions if you install Public Sans or want me to construct the three caps as paths.)*
2. **Wire the icons in.** `manifest.json` currently points its 192/512 icons at `QCU college of computer studies logo.jpg`. Swap in `icon-192.png` / `icon-512.png` / `maskable-512.png` and add the favicon links from `head-snippet.html` to the page `<head>`. (I haven't modified `manifest.json` — say the word and I will.)
3. **Trademark / familiarity check.** A ringed **Q** is a common letterform (e.g. QuickTime historically used a Q). Do a quick trademark + reverse-image search before any official use; I can't guarantee clearance.
4. **Seal permission.** As an independent project, confirm you're comfortable crediting QCU / QC Government with their seals; keep the "independent student project" wording so nothing implies official endorsement.

## Notes
- Everything is flat by rule — no shadows/gradients, matching `.impeccable.md`. Light-mode first.
- The gold hand can optionally be reused in-product to mark the *current* class block; keep red for suspensions only.
