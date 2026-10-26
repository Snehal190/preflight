# Seller script: exactly 2 rules wrong

Open **http://localhost:3040/chat**, then type or speak each line in order. Checked live on 26 Oct 2026.

## 1. Say this

> Hi, this is Harbour Home Goods. I'm sending 1,080 ceramic dinner plates, SKU PLATE-01, from
> Birmingham to Hamburg. They're £6 each, packed 12 to a box, 90 boxes, on 2 pallets. Each plate
> weighs 0.8 kilos and the whole shipment weighs 900 kilos. The total declared value is £5,000.
> The HS code is 69120 and they're made in China. It's ready next Monday. Cheapest please. It's
> going to a warehouse and we've already booked the delivery slot.

**Planted mistakes (the other 8 rules pass):**

| Rule | What's wrong |
|---|---|
| Customs (HS) code | 69120 has only 5 digits; customs needs at least 6 (691200) |
| Declared value matches the products | £5,000 declared, but 1,080 × £6 = £6,480 (22.8% gap) |

**Expect:** "I spotted 2 things to fix", then 2 questions: the full HS code, and "change declared
value from £5,000 to £6,480?"

## 2. To see both problems on the verify screen, keep them

| You say | What you should see |
|---|---|
| I don't know the full code, and no, keep the value as it is. | An AI HS suggestion (691200). "Shall I use it?" |
| No, leave it for now. | "OK, no HS code for now…" then the full read-back, with both problems under "Still to sort out" |
| Yes, that's all correct. | Goes to the check page: **2 must-fix**, 8/10 in the box, the box stays open and two red tags fall off |

On the check page, **What to fix** lets you apply "£5,000 → £6,480" and type the HS code 691200.
Then the box seals, the carrier appears (Carrier A, £360), and **Approve** sends the lorry onto the ferry.

## Or fix them in the chat instead

Reply to step 1 with: **"The HS code is 691200, and yes, change the value to £6,480."** Then
"Yes, that's all correct." The check page shows all 10 passing and goes straight to the carrier.
