# PreFlight test pack

Two things to test: **voice/chat** booking and **upload** of two sheets. Every expected result
below was checked by running it through the app (the sheets also have an automated test:
`tests/test-pack.test.ts`). Dates assume testing during the week of 26 Oct 2026.

Start the app, then open **http://localhost:3040**.

---

## 1. Voice script (Talk or type to book)

Open **Talk or type to book**. For each line: press **Tap to speak** and say the line — your words appear in the box as you
speak, and recording stops by itself when you pause. A 4-second "Sending…" countdown then
starts: tap **Tap to edit** to fix a misheard word, or let it send. You can also type the lines.
The **What to tell us** checklist ticks off each detail as it's captured.

| # | Say this | What you should see |
|---|---|---|
| 1 | "Hi, I'm shipping 600 scented candles from Leeds to Rotterdamm. They're £8 each, 24 to a box, and it's going on two pallets." | Reads "Rotterdamm" as **Rotterdam** and asks you to correct it if wrong. Netherlands filled from the city. Numbers spelled out (600 (six-zero-zero)). **Works out** 25 cartons (600 ÷ 24), total cartons 25 and declared value £4,800. Asks **at most 3** questions: unit weight, gross weight, HS code. |
| 2 | "Sorry, the price is actually 10 euros each." | **"Please give the value in GBP."** — the price stays £8 (never converted). |
| 3 | "And it's collected from Bristol, not Leeds." | Refuses Bristol: **"I can only book from London, Birmingham or Leeds."** Origin stays Leeds. |
| 4 | "Each candle weighs 400 grams. I don't know the total gross weight." | Converts **400 g = 0.4 kg**. Asks **"What does an empty pallet weigh?"** |
| 5 | "No idea what an empty pallet weighs either, and I don't know the HS code." | **ASSUMPTION** in bold: estimated gross weight **290 kg = 240 kg + 2 pallets × 25 kg**. Offers an **HS suggestion (e.g. 340600), labelled "please verify; you are legally responsible"**, and asks "Shall I use it?" |
| 6 | "Yes, use that code." | HS code recorded as confirmed. |
| 7 | "They're made in India. There's no SKU." | Origin India. **ASSUMPTION:** no SKU, using **ITEM-1**. |
| 8 | "It'll be ready to ship next Friday." | Reads the date back with its weekday: **"Friday 30 Oct 2026 — correct?"** |
| 9 | "Yes." | Date confirmed. |
| 10 | "Fastest please. It's going to a shop, and the seller is Brightwick Candles." | "shop" → **Business address**; **no appointment question**. Nothing missing → **full read-back** of every field and item. Panel: carrier **C**. |
| 11 | "Add a pallet." | **Pallets 2 → 3**. Estimate recomputes to **315 kg**. Panel chips: `Pallets 2 → 3 · Total gross weight 290 → 315 · Cost £640 → £960 · Carrier unchanged`. |
| 12 | "Also add 50 power banks, 10000 mAh, £15 each, 10 per box, 300 grams each, made in China, HS code 850760, SKU PB-10." | Adds the product, works out 5 cartons; derived totals recompute (30 cartons, £5,550). Asks in plain words: "…contains "power bank", which means a lithium battery. That can't go on a normal road shipment. **Shall I remove** power banks…?" |
| 13 | "Remove the power banks." | Removed; totals back to 25 cartons / £4,800; R-06 clears. |
| 14 | "Make it 4." | Ambiguous → asks **which detail** "4" refers to (doesn't guess). |
| 15 | "I meant 4 pallets." | Pallets 4; estimate 340 kg; read-back shown again. |
| 16 | "Yes, that's all correct." | **"Everything's confirmed. Your checks: Ready for take-off."** Then **Open the check page →** → Carrier C (fastest), **£1,280**, collection Fri 30 Oct, delivery **Tue 03 Nov 2026**, with the working-days ASSUMPTION. Continue → Carrier → Take-off. |

**Also try:** turn the assistant off (remove `GEMINI_API_KEY` from `.env.local`, restart) and send a
message — you get "The assistant is unavailable right now — you can fill in the booking form
instead", and the **Booking form** in the side panel still runs every check.

Notes:
- Speech-to-text can mishear (fifteen/fifty). That's why the transcript is editable and never sent
  automatically, and why numbers are read back digit by digit in voice mode.
- The AI's exact HS suggestion wording can vary; it's always labelled and only used if you say yes.

---

## 2. Upload: `Bookings.xlsx` + `Items.xlsx`

Open **Upload your sheets**, choose **both files** together, and press **Check my bookings**.

**Banner (file-level):**
- Skipped the template's example row (row 3) — and the example item row.
- Ignored extra column in the Bookings sheet: "Notes".
- T-13 appears 2 times in the Bookings sheet (rows 16, 17).
- Items sheet row 24 refers to T-99, which isn't in the Bookings sheet.

(The Items sheet's columns are deliberately in a different order — they're matched by name.)

| Booking | What's planted | Expected result |
|---|---|---|
| T-01 | Clean; real Excel date cell; priority Balanced | **Ready**. Carrier **B, £440** (Balanced; Medium confidence). |
| T-02 | Quantity 1,800 but 12 × 90 = 1,080 | **Red R-02 + R-03**. Fix: "Change MUG-01 quantity from 1,800 to 1,080 — two digits swapped — tested: clears R-02 and R-03". **Apply fix** → Ready. |
| T-03 | Booking cartons 100, items add up to 90 | **Red R-04**. Fix: change booking cartons to 90. |
| T-04 | Candle: HS blank, origin blank. Coffee: HS typed as number 90121 | **Red R-01 ×2** (coffee: "did you mean 090121?"), **Amber R-09**. |
| T-05 | 1,800 kg on 4 pallets, priority Fastest | **Ready**, carrier **B**; a non-blocking R-05 note for C: "repack onto 5 pallets: £1,700 vs £880 with B — £820 more, 1 day sooner". |
| T-06 | 2,400 kg on 3 pallets (800 kg each) | **Red R-05**: no carrier fits — "Repack onto at least 4 pallets", with each carrier's minimum. |
| T-07 | Power bank 10000mAh; "Portable charger" (HS 8507…); "Torch, batteries not included" | **Red R-06** (power bank); **Needs your answer** for the charger ("Does 'Portable charger' contain a lithium battery?" — or Red if the AI is confident); torch passes. |
| T-08 | Gross 400 kg, products weigh 540 kg | **Amber R-07** (re-weigh). |
| T-09 | Ready date 01-10-2026; warehouse, no appointment | **Amber R-08 + R-10** → "Check before shipping"; acknowledge both (type your name) → Ready. |
| T-10 | Pallets 2.5, currency EUR, priority blank | **Missing data**: pallets (whole number), currency ("EUR" not allowed), priority. |
| T-11 | Numbers typed as text ("1,080", "£5.00", "5400 GBP", " 90 "), HS "6912.00", date 5/11/2026, item ID "t-11" | Reads them all correctly → **Ready**. |
| T-12 | Paris + Germany; MUG-01 listed twice; a £0 leaflet | **Info only** (city/country — priced on Germany, duplicate SKU, £0 price) → **Ready**. |
| T-13 / t-13 | Same booking ID twice | Both **Missing data**: "Two bookings share this ID". |
| T-14 | Date 31-02-2026 | **Missing data** on R-10 (date doesn't exist — never rolled to March). |
| T-15 | Cartons is a formula with no saved value | **Missing data** on R-04: "formula with no saved value — please paste values". |

Things to try on the Check page: **Apply fix** on T-02 and T-03, answer the charger question on
T-07, acknowledge the Ambers on T-09, edit a field, then **Version history → Undo**.
