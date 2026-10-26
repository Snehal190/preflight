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

**Expect:** the reply starts with **"I spotted 5 things to fix:"** listing all five in plain words,
then asks up to 3 questions, most serious first: the HS code, **"Did you mean: change … quantity from
1,800 to 1,080? (Looks like two digits were swapped.)"**, and when it will actually be ready. The
checklist shows what you said (Birmingham, 1,800, 69120…) and marks wrong values red.

## 2. Then reply

| You say | What you should see |
|---|---|
| "Sorry, the HS code is 691200. And yes, change it to 1,080." | Both fixed. The weight problem clears by itself (1,080 × 0.8 = 864 kg ≤ 900 kg). Asks about the delivery slot and the SKU. |
| "It'll actually be ready next Monday." | **"Ready to ship Monday 02 Nov 2026 — correct?"** |
| "Yes." | Date confirmed; full read-back, with the slot under "Still to sort out". |
| "The SKU is PLATE-01." | Read-back again. |
| "Yes, I've booked the slot now." | Status **Ready for take-off**. |
| "Yes, that's all correct." | **"Everything's confirmed. Your checks: Ready for take-off."** |

Then **Your booking → Open the full check →** Carrier A Road economy, £360, collection Mon 02 Nov,
estimated delivery Mon 09 Nov 2026 → Continue to carrier → Confirm → Take-off page.

Tips: if a word is misheard, tap **Tap to edit** during the 4-second countdown. Nowhere should you
see rule codes like "R-03" — only plain names.
