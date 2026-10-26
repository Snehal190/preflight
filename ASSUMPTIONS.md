# Assumptions and approved decisions

Every value or behaviour the spec does not pin down is listed here. Nothing goes in this file
unless the product owner approved it. Assumptions with an `A` ID are also in
`lib/reference/assumptions.ts` and are shown on screen in bold as **ASSUMPTION:**.

## Value assumptions (shown to the seller)

| ID | Assumption | Why | Code |
|---|---|---|---|
| A1 | Empty pallet weight = 25 kg (standard UK wooden pallet). Used only after the seller says they know neither their gross weight nor their pallet weight. | Spec §3.2 / §12.5 | `lib/reference/assumptions.ts`, `lib/chat/` |
| A2 | Transit days are working days (Mon–Fri, excluding public holidays). | Rate card doesn't say (§11) | `lib/dates/` |
| A3 | R-02's "within 1%" is measured against the item total (Σ quantity × unit price). | Rulebook doesn't give the base | `lib/rules/r02.ts` |
| A4 | When the seller has no SKU (asked once), items are numbered `ITEM-1`, `ITEM-2`, … | Spec §12.2; approved Q19 | `lib/chat/` |
| A5 | When the destination city is not in the destination country, the route is priced on the country column. | Spec §5.4 rule 20; approved Q19 | `lib/rules/info.ts`, `lib/carrier/` |
| A6 | A unit weight computed from a carton weight (carton weight ÷ units per carton) includes the carton's own packaging. | Spec §12.5; approved Q19 | `lib/chat/` |
| A7 | For a Business address, "Delivery appointment booked" is set to No and R-08 is not applicable. | Spec §12.2; approved Q19 | `lib/chat/` |
| A8 | Public holidays not checked (holiday service unavailable) — weekends only. | Spec §11.3; approved Q19 | `lib/dates/` |
| A9 | When net weight can't be computed (a unit weight is missing), carrier eligibility and R-05 use gross weight alone. | Approved Q13 | `lib/carrier/` |

## Approved design decisions (from the pre-build Q&A, 2026-10-25)

| # | Decision | Code |
|---|---|---|
| Q1–3 | Project lives in `~/Desktop/preflight`; private repo, Vercel auto-deploy on push; Neon database `preflight` in the existing Neon project. | — |
| Q7 | R-01: a numeric HS cell with 5 digits is Red with the leading-zero hint. With 7 or 9 digits it passes R-01 (≥ 6 digits) and gets an **Info** card with the hint. | `lib/rules/r01.ts` |
| Q8 | R-06 tiers: device words (phone, smartphone, laptop, tablet, smartwatch, earbuds, wireless headphones, drone, action camera, e-bike, e-scooter, hoverboard) and ambiguous drink words (gin, rum, spirits) give **Needs your answer**, not Red. Unambiguous words go straight to Red. Accessory words (case, cover, sleeve, stand, holder, strap, screen protector, glass, mug, empty bottle) were approved as negations — see note below. | `lib/reference/dangerousGoods.ts` |
| Q9 | `\d+ mAh` (e.g. "10000mAh") counts as a lithium keyword. | `lib/reference/dangerousGoods.ts` |
| Q10 | Gemini dangerous-goods confidence is `high | medium | low`; only `high` turns a flag Red; `medium`/`low` → Needs your answer. | `lib/rules/r06.ts` |
| Q11 | Every pallet-count suggestion uses `evalWeight = max(gross, net)`, never gross alone. | `lib/carrier/`, `lib/repair/` |
| Q12 | If no carrier is eligible on evalWeight (even if gross alone would pass), R-05 is a blocking Red whose card shows the net-weight figures. R-05 for a chosen carrier is evaluated on evalWeight. | `lib/rules/r05.ts` |
| Q14 | Audio uploads capped at 4 MB (Vercel body limit 4.5 MB). | `app/api/` |
| Q15 | A declared value of 0 is accepted by the parser; R-02 decides. | `lib/parse/` |
| Q16 | The template's example item row is skipped only when the example booking row was also skipped. | `lib/parse/` |
| Q17 | A currency other than GBP in an upload → Missing data, showing the raw value. | `lib/parse/` |
| Q18 | Past ready date → collection is today if today is a working day, else the next working day. | `lib/dates/` |
| Q20 | Amber acknowledgement: the seller types their name; name + timestamp stored in version history. | `lib/db/` |
| Q21 | Two IDs per booking: private edit link (can edit/delete) and read-only share link. | `lib/db/` |
| Q22 | Results table sort: Blocked → Check → Ready; then Red, Missing, Needs answer, Amber (desc); then booking ID. | `lib/booking/` |
| Q23 | Rate limits store a salted hash of the IP, never the raw IP. | `lib/db/` |
| Q24–26 | UI: no login/sign-up, no waitlist, no testimonials; "THE PREFLIGHT WAY"; Tailwind; inline SVG icons; Satoshi self-hosted via `next/font/local`, Anton via Google; style applied at step 10. | `app/` |

### Pending confirmation

- **Accessory words downgrade rather than cancel.** Q8 approved accessory words as negations.
  To avoid passing e.g. "Phone with case" or "Whisky in glass bottle", the implementation makes
  an accessory word turn a keyword hit into **Needs your answer** ("Does 'Phone case' contain a
  lithium battery?") instead of silently passing it. One click of "No" clears it. Awaiting
  product-owner confirmation.
- **Origin / Destination columns.** The §2.4 example shows `Manchester, United Kingdom` in one
  "Origin" field. The parser accepts either one "City, Country" column (split on the last comma)
  or separate "Origin city" / "Origin country" columns. To confirm against the real template.
  (`lib/parse/index.ts`)
- **Orphan items affect no booking.** An Items row whose Booking ID matches no booking is reported
  in the banner only. §9.8 says to block Apply on "a booking with orphan problems", but an orphan
  can't be tied to a specific booking, so no booking's Apply is blocked. (`lib/parse/index.ts`)
- **Only real days off count as holidays.** Nager.Date lists some observances (e.g. NL Good Friday,
  Liberation Day 2026) that aren't days off; only `Public`/`Bank` types are skipped.
  (`lib/dates/holidays.ts`)
- **Date strictness.** An Excel serial with a time fraction, and ISO text like `2026-11-05`, are
  Missing data rather than guessed (the spec lists only day-first text, real dates and serials).
  A 5-digit number typed as text is read as a serial. (`lib/parse/values.ts`)
- **Repair pairs must earn their place.** A pair of edits is shown only if it clears something
  neither of its edits clears alone (otherwise "good fix + pointless edit" pairs crowd the top 3).
  The non-blocking R-05 preferred-carrier note isn't counted as a "new failure", but a fix that
  makes it appear says so in its evidence. (`lib/repair/index.ts`)
- **Gemini model and key (local).** `GEMINI_MODEL=gemini-flash-latest`: chosen because it accepted the
  structured-JSON schema in a live test; `gemini-2.5-flash` is closed to new users. The key is shared
  event key #2 (#3 also valid; #1 rejected). Both live in `.env.local` only. Please confirm the model and
  which key the team should use.
- **Pages before the database (interim).** You asked for a localhost link to test, so the upload path
  pages were built before the Neon step. Until `DATABASE_URL` arrives, bookings, versions and
  acknowledgements live in the browser's localStorage (`lib/client/store.ts`); share links, rate
  limiting and the DB caches are not built yet. (`lib/client/`)
- **Chat interpretation choices (step 8).** To confirm:
  - "next Thursday" = the first Thursday after today; a bare "Thursday" on a Thursday = today.
    Every resolved date is read back with its weekday and must be confirmed.
  - Fuzzy matching: Fuse.js proposes, but a match is accepted only within 1 typo (≤ 5 letters) or
    2 typos (longer) and only if unique — so "Munich" is never read as Manchester.
  - Weights: kg by default; lb, tonnes and grams are converted (shown in the reply); "tons" is
    refused as ambiguous (UK/US/metric).
  - Quote check: a number must appear in the seller's quote, either as digits or as a number word
    ("add a pallet" supports 1).
  - "No SKU" style answers never become a SKU; after asking once, ITEM-n is used (A4).
  - Gemini calls use `thinkingLevel: LOW` (default thinking exceeded the 20 s deadline in testing).

## Approved changes after the first build (2026-10-26)

| Change | Why | Code |
|---|---|---|
| **Voice transcripts auto-send** after a 4-second "Sending… tap to edit" countdown (replaces spec §12.1 "never auto-send"). Any tap or edit cancels it. Numbers are still read back digit by digit. | Product owner's request; the countdown keeps a chance to fix misheard numbers. | `app/chat/[id]/View.tsx` |
| **Live words while speaking** use the browser's speech recognition (Chrome/Edge/Safari; Chrome sends audio to Google's speech service). Gemini still makes the final transcript; if it fails, the live words are used with a warning. Recording stops after 2.5 s of silence. | Product owner approved. | `app/components/VoiceRecorder.tsx` |
| **No rule codes on seller screens.** Cards, chips and chat use plain names ("Units, boxes and quantity add up"); statuses read Must fix (Red), Please check (Amber), Advice (Info), Missing info, Question for you. The code and official wording appear in each card's Why? panel and on the Rules page. | Sellers don't know the rulebook. | `lib/reference/rulebook.ts`, `app/rules/` |
| **Chat asks about problems** found by the checks, in plain words, once each; a tested fix is offered as "Did you mean …?" and applied on "yes". | Product owner's request. | `lib/chat/clarify.ts` |
| **Worked-out values recalculate** after any applied fix and are never suggested as edits themselves. | A fix must not freeze a value code calculated. | `lib/booking/derived.ts` |
| **Day + month with no year** (e.g. "the 20th of October") is this year's date if it fell within the last 90 days — and the bot says it's in the past — otherwise the coming one. Always read back with the weekday. | Jumping to next year hid a past-date mistake. | `lib/chat/dates.ts` |
| **One product, "90 boxes"** → that product's box count (so units × boxes is checked against quantity); a booking total only applies with several products. | Otherwise a quantity typo showed up as a confusing box-total mismatch. | `lib/chat/engine.ts` |
| **Yes/no routing**: a plain "yes"/"no" answers the first open yes/no question; a longer message only answers a question its words name (e.g. "ready", a day → the date). | "Yes, 1,080 is right" was confirming the date. | `lib/chat/engine.ts` |
| **New design system (replaces the Anton/Satoshi brief):** Inter + JetBrains Mono, blue-grey canvas, white cards, steel/blue accent, automatic dark mode, from the product owner's "PreFlight One Screen" inspiration. Satoshi files removed (no font-licence constraint on the repo any more). | Product owner's new inspiration. | `app/globals.css`, `app/layout.tsx` |
| **three.js 0.180.0 added** (approved) for the 3D parcel and road/sea band on the home screen, loaded lazily on that screen only; static frame for reduced motion, plain fallback without WebGL. 3D models written from scratch, not copied from the inspiration. | Product owner chose real 3D. | `app/components/three/` |
| **Home = one-screen check.** Sample bookings (dates relative to today) run through the same `/api/evaluate` as everything else; "Fix all" applies only tested numeric fixes, re-checking after each. Rule names stay plain (no R-codes). The route chip says "Channel crossing" rather than naming a specific ferry route. | Product owner's inspiration; a specific crossing would be an invented fact. | `app/page.tsx`, `lib/stage/` |
| **Chat lists every problem** it finds in an "I spotted N things to fix" summary, then asks up to 3 questions most-serious first; a problem a pending fix would also clear (e.g. weight explained by a quantity typo) isn't asked separately; a past date isn't read back as "— correct?" (it's asked as a problem). The checklist shows captured values and marks flagged ones red. | Product owner's test: the 1,080 typo wasn't asked first and the checklist looked like it said Manchester. | `lib/chat/engine.ts`, `lib/chat/clarify.ts`, `lib/chat/checklist.ts` |
| **Home 3D scene**: one depot scene — the open carton rides on the lorry's flatbed; a flap closes after 3, 5, 8 and 10 checks pass and it's taped at 10; the lorry stays parked until the seller approves the carrier, then drives onto the ferry and sails. Spacious layout after the first UI brief; carrier recommendation explained from the numbers. | Product owner's feedback on the first 3D version. | `app/components/three/DepotScene.tsx`, `lib/stage/flaps.ts`, `lib/stage/carrierStory.ts`, `app/page.tsx` |
| **Palette: black, white, yellow and grey** (replaces the blue/steel accent). Yellow #ffd21f is used for fills (buttons, highlights, progress, selected states) always with black text; accent text is black in light mode and yellow in dark mode, because yellow text on white is unreadable. Red/green/amber stay only as small status colours (must fix / passed / please check) because they carry meaning. | Product owner's request. | `app/globals.css`, `app/components/three/` |
| **One flow, one step after another** (replaces the one-screen home and its sample bookings): the landing page offers only "Speak or type" and "Upload your sheets" — no samples. Once the chat readback is confirmed (or a single-booking upload is read) the seller goes straight to the booking's check page: verification (the 3D box stays open while each rule drops in, calmer motion, with a deep analysis of what's right, what's wrong, the fix and why) → what to fix → carrier recommendation → approve, then the lorry drives onto the ferry. The box only seals when the booking is ready, so an unaccepted "please check" keeps it open. | Product owner's request. | `app/page.tsx`, `app/batch/[batchId]/[key]/View.tsx`, `app/components/VerifyStage.tsx`, `app/components/CarrierPanel.tsx` |
| **No em dashes** in anything sellers see (screens, chat replies, AI reasons): replaced with commas, colons or "·"; a blank value shows "-". Example text names the UK and the three destination countries instead of "Manchester to Frankfurt". | Product owner's request. | `app/`, `lib/chat/`, `lib/ai/index.ts` (`noDash`) |
| **Manchester is no longer a collection city.** Allowed origins are London, Birmingham and Leeds; a seller who says Manchester is told we can't collect from there, and an uploaded Manchester origin is flagged. The template's own example row (BK-001, Manchester) is unchanged because it's only used to recognise and skip that row. Samples now use Leeds. | Product owner: "we do not send from Manchester". | `lib/reference/allowed.ts`, `scripts/make-*.mjs` |
| **Rules checklist (docs/RULES-CHECKLIST.md) is now the spec for edge cases**, with one probe test per item (`tests/checklist.test.ts`) and the judges' Test3 workbook as a regression test (`tests/judges.test.ts`). Changes it brought: "Quantity (units)" and other header aliases are read; R-06 treats phones, laptops, tablets, earbuds, smartwatches, cameras, drones, e-bikes, "rechargeable", gin/rum/spirits as Red, while accessories ("phone case", "laptop sleeve", "gin glass"), alkaline/AA, "no electronics", vitamin tablets pass; only HS 8507.60/8506.50 hint lithium; an HS-code-only match asks the seller to confirm; the SKU is scanned separately. A blank warehouse appointment is Amber "missing", not blocking. A 0.001 kg margin on R-07. A non-blocking R-05 shows as "please check" on the 3D stage. Every booking gets a carrier recommendation (provisional without pallets; "once repacked onto N pallets" when nothing fits). Past ready date → collection on the next working day from today (replaces Q18). 5-digit HS codes always get the leading-zero hint. | Product owner's checklist, 26 Oct 2026. | `lib/reference/dangerousGoods.ts`, `lib/rules/*`, `lib/carrier/index.ts`, `lib/dates/delivery.ts`, `lib/parse/index.ts` |
| **Manchester is allowed again** as a collection city (the judges' Allowed values list it) but isn't used in any example or hint. Refusals list all four cities. | Judges' data may use it; product owner asked for no examples with it. | `lib/reference/allowed.ts` |
| **Speak or type changes after upload**: the results page and each booking page have "Tell us what's different". It reuses the chat engine in edit mode: stated values are kept as stated, products are matched by SKU or name (never invented), only new problems are reported, then "Re-checked: …". AI dangerous-goods advice remembers which description/HS code it was for and is redone when either changes. "Apply all tested fixes" applies only tested number fixes. | Product owner's request. | `app/api/booking-chat/`, `app/components/ChangeBox.tsx`, `lib/chat/engine.ts` (`editSession`) |
| **Not built yet (waiting on you):** the commercial invoice and carton-labels PDF (checklist 86, needs your invoice template) and the warehouse slot-date note (checklist 88, the template has no slot-date column). | Inputs not provided yet. | |
