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
