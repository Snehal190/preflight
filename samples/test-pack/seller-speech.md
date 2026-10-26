# Seller speech — some details right, some wrong

Open **http://localhost:3040/chat** (or **+ Start a new booking**). Tap **Tap to speak**, say the
speech, and let it send. Then reply to each question as below. Verified live on 26 Oct 2026; the
exact wording can differ slightly, but the questions and results should match.

## 1. Say this (about 35 seconds)

> "Hi, this is Harbour Home Goods. I'm sending 1,800 ceramic dinner plates from Birmingham to
> Hamburg. They're £6 each, packed 12 to a box, 90 boxes, on 2 pallets. Each plate weighs 0.8
> kilos and the whole shipment weighs 900 kilos. The HS code is 69120 and they're made in China.
> It's ready on the 20th of October. Cheapest please. It's going to a warehouse and we haven't
> booked a delivery slot yet."

**What's right:** seller, Birmingham → Hamburg, £6 each, 12 per box, 90 boxes, 2 pallets,
0.8 kg each, made in China, Cheapest, warehouse.

**What's wrong (planted):**

| Mistake | Why it's wrong | What PreFlight should do |
|---|---|---|
| 1,800 plates | 12 per box × 90 boxes = 1,080 (two digits swapped) | Ask "Did you mean: change … quantity from 1,800 to 1,080? (Looks like two digits were swapped.)" |
| HS code 69120 | Only 5 digits; customs needs at least 6 | "HS code 69120 has only 5 digits. What's the full customs code?" |
| Ready 20th October | That date has passed | "Tuesday 20 Oct 2026 — that date is in the past" |
| 900 kg total | 1,800 × 0.8 kg = 1,440 kg of plates alone | "…products alone weigh 1,440 kg — that can't be right…" |
| No delivery slot | Warehouses turn away trucks without one | "…have you booked a slot?" |

**Expect:** the checklist ticks most items; status **Blocked · 3 must-fix · 3 to check**;
provisional carrier B (A can't take 720 kg per pallet of plates).

## 2. Then reply to the questions

| You say | What you should see |
|---|---|
| "No, sorry — it'll be ready next Monday. And the HS code is 691200." | Date becomes **Monday 02 Nov 2026 — correct?**; HS code fixed. Asks if the plates have a SKU. |
| "Yes." | Date confirmed. Now asks: **"12 per carton × 90 cartons = 1,080, but quantity says 1,800. Did you mean … 1,080?"** |
| "Yes, change it to 1,080." | **"Done — change … quantity from 1,800 to 1,080."** The weight problem clears by itself (1,080 × 0.8 = 864 kg ≤ 900 kg), the declared value recalculates to £6,480, and the carrier switches to **A, £360**. Asks about the delivery slot. |
| "The SKU is PLATE-01." | Full read-back of every line, with the slot still listed under "Still to sort out". |
| "Yes, I've booked the slot now." | Slot = Yes. Status **Ready for take-off**. Read-back again. |
| "Yes, that's all correct." | **"Everything's confirmed. Your checks: Ready for take-off."** |

Then **Your booking → Open the full check →** Carrier A Road economy, £360, collection Mon 02 Nov,
estimated delivery Mon 09 Nov 2026 → Continue to carrier → Confirm → Take-off page.

Tips: if a word is misheard, tap **Tap to edit** during the 4-second countdown. Nowhere should you
see rule codes like "R-03" — only plain names.
