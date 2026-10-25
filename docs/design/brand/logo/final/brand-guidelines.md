# QCU Schedule — Logo Usage Guide

**One idea:** the **Q** is a clock face and its tail is the hand — *QCU, built around the one question the app answers: "do I have class today?"*

Independent student project. Calm, truthful, institutional — a public-service status board, not a consumer app.

---

## The marks

| File | Use |
|---|---|
| `final-symbol-color.svg` | Primary symbol (blue Q, gold hand) — app tile, favicon, avatar |
| `final-horizontal.svg` | Primary lockup — headers, wide spaces |
| `final-stacked.svg` | Stacked lockup — square/centered spaces, splash |
| `final-endorsement.svg` | Centered lockup with the QCU + QC Government seals |
| `final-symbol.svg` / `-small.svg` | One-colour master / bold cut for ≤32 px |
| `final-symbol-reversed.svg` | White Q + gold hand, for dark/photo backgrounds |

The **small cut** (`-small.svg`) has a thicker ring and hand; it feeds the favicon and anything under ~32 px. Use it, not the master, at tiny sizes.

---

## Colour

| Role | Name | HEX | RGB |
|---|---|---|---|
| Primary | QCU Blue | `#005BAC` | 0 91 172 |
| Text / deep | Navy | `#0B2A4D` | 11 42 77 |
| Accent (the hand) | Gold | `#F2A900` | 242 169 0 |
| Ink (one-colour) | Ink | `#111111` | 17 17 17 |
| Ground | White | `#FFFFFF` | 255 255 255 |

**Reserved — not part of the logo:** flag red `#CE1126` is kept for *suspended / alert* status in the product only. Never colour the mark red.

One-colour fallbacks: all-blue (`#005BAC`), all-ink, or all-white. The idea survives in a single colour — always prefer a one-colour version over a low-contrast two-colour one.

---

## Clear space & minimum size

- **Clear space:** keep free space equal to the Q's ring thickness on all four sides (≈ 15% of the symbol height). Nothing — text, seals, edges — inside it.
- **Minimum size:** symbol **16 px** (favicon); horizontal lockup **≥ 120 px** wide; stacked lockup **≥ 96 px** wide. Below these, drop to symbol-only.

---

## Backgrounds

- Prefer **white**. On colour, use the **reversed** mark (white Q + gold hand) on QCU Blue or Navy.
- On the blue app tile the mark is **white** (see `apple-touch-icon.png` / `icon-512.png`) — never place the blue mark on blue.
- Avoid busy photos; if unavoidable, use the reversed mark over a solid scrim.

---

## The QCU + QC Government lockup

This is an **independent student project**. The seals in `final-endorsement.svg` are the institutions' own marks, used **as-is** under the honest line *"An independent student project for Quezon City University · Quezon City Government."*

- Do **not** redraw, recolour, stretch or crop the official seals.
- Do **not** present the app as officially endorsed, or imply government authorship.
- Use the endorsement lockup only where the credit is appropriate (About, footer, splash) — the plain `QCU Schedule` logo is the everyday mark.

---

## Misuse — don't

- Don't recolour the hand (gold only) or swap the blue/gold roles.
- Don't add gradients, drop shadows, bevels or glows — the identity is flat by rule.
- Don't rotate, skew, stretch, or outline the mark; don't re-space the wordmark.
- Don't put the mark in a box when it already sits on a clean background.
- Don't rebuild the Q in another typeface — use the supplied files.

---

## Typography

Wordmark and UI: **Public Sans** (SIL Open Font License — cleared for logo use). Weight carries hierarchy — 800 for `QCU`, 500 for `Schedule`. The product already ships Public Sans.
