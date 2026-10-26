# PreFlight rules checklist (from the product owner, 26 Oct 2026)

Everything below must hold. Numbers in brackets are the item numbers the product owner refers to.

## A. The 10 official rules, with every edge case

### R-01: HS code has at least 6 digits (Red)
1. A blank HS code fails, and it's Red. The Field Guide says the column "may be blank", but the rulebook wins.
2. Read 691200.0 as the whole number 691200 before counting digits.
3. Count digits only. Strip spaces, dots and dashes, so 6912.00 and 6912 00 both count as 6 digits.
4. A code with letters or other junk fails, with an "invalid code" message.
5. A dropped leading zero (90111) is still Red, with a hint suggesting 090111.
6. Codes of 8 or 10 digits pass. Anything over 10 digits passes R-01 but gets an Info note.
7. 000000 passes R-01 but gets an Info "not a real code" note.
8. Checked per item; the message names the item row and SKU.

### R-02: Declared value within 1% of sum of quantity × unit price (Red)
9. gap = |declared − sum| ÷ sum (denominator is the item sum).
10. A gap of exactly 1.0% passes. Over 1% fails.
11. Sum 0: declared 0 with sum 0 passes plus an Info note; declared > 0 with sum 0 fails.
12. Use the stated quantities, even when R-03 fails on the same item.
13. Round only for display, never inside the calculation.
14. A booking with no items gives a sum of 0.

### R-03: Units per carton × cartons = quantity, per item (Red)
15. Exact match on whole numbers, no tolerance.
16. Fractional, zero or negative values for any of the three numbers get flagged.
17. Message names the item and shows the implied quantity.

### R-04: Booking cartons = sum of item cartons (Red)
18. Exact match.
19. A booking with no items fails (item sum 0).
20. If R-03 also fails, say which number the evidence points to as wrong (repair engine).

### R-05: Gross weight ÷ pallets ≤ chosen carrier's max (Red)
21. Exactly at the limit passes.
22. Pallets 0, blank, negative or fractional → "cannot check", not a crash.
23. IMPORTANT: if the carrier the seller's priority points to fails R-05, show R-05 as a visible issue ("C can't take 450 kg pallets"), fix = "switch to B (our pick) or use 5 pallets". Red only when no carrier fits. (e.g. 450 kg/pallet, priority Fastest must NOT show a green tick.)
24. If R-07 shows the gross weight is too low, also run R-05 using the item weight total.
25. Show pass/fail for each carrier, for every booking.

### R-06: No lithium batteries, aerosols or flammable liquids (Red)
26. From Description, plus SKU and HS code as hints.
27. Lithium: power bank, Li-ion, mAh, rechargeable, phone, laptop, tablet, smartwatch, earbuds, vape/e-cigarette, e-bike/e-scooter, camera, drone, rechargeable toys.
28. Aerosol: hairspray, spray deodorant, dry shampoo, spray paint, compressed air duster, insect spray, whipped cream canisters.
29. Flammable: perfume, eau de parfum/toilette, cologne, nail polish and remover, acetone, hand sanitiser, spirits (vodka, whisky, gin), lighter fluid, white spirit, paint thinner, solvent-based paint or varnish, isopropyl alcohol, reed diffusers, some essential oils.
30. False positives to avoid: "battery-free", "batteries not included", "no batteries", alkaline or AA batteries, "pump spray"/"trigger spray", water-based paint, candles, "alcohol-free". Accessories such as a phone case "(no electronics)" or a laptop sleeve are not lithium.
31. HS hints: 8507.60, 8506.50, 3303, 3208, 2208, 3606, 3307. Policy: clear match in words or confident AI flag = Red; a match on HS code alone = "please confirm".
32. Always show the word or reason that triggered the flag.
33. Fix: remove the item or ship separately as dangerous goods. No one-click fix.

### R-07: Gross weight ≥ sum of unit weight × quantity (Amber)
34. Exactly equal passes.
35. Tiny margin for decimal rounding (0.001 kg).
36. Use stated quantities.

### R-08: Warehouse needs a booked appointment (Amber)
37. Warehouse + No = Amber; Warehouse + Yes passes.
38. Business address with either answer = not applicable.
39. Blank value for a warehouse = Amber, shown as "missing".
40. Accept "Y", "yes", "YES"; destination type in any case.

### R-09: Every item has a country of origin (Amber)
41. Blank fails.
42. In chat, map "UK", "England", "Britain", "made here" to United Kingdom.
43. Never fill it with United Kingdom just because the shipment leaves the UK.

### R-10: Ready date not in the past (Amber)
44. Compare with today in UK time. Today passes.
45. Accept DD-MM-YYYY text, real Excel date, Excel date number, DD/MM/YYYY.
46. Impossible date (31-02-2026) is flagged, never rolled over.
47. In chat, "next Thursday" is worked out from today and read back.

## B. File reading and data integrity
48. Find the header row by searching for "Booking ID"; don't assume row 2.
49. Find sheets by headers, not sheet name. One workbook, two files, or CSVs.
50. Match columns by header name; reordered or extra columns still work. (The judges' Items sheet uses "Quantity (units)"; Bookings may have separate "Origin city"/"Origin country"/"Destination city"/"Destination country" columns.)
51. Trim spaces and ignore case for headers and values.
52. Skip the grey example row only if identical to the template's example; tell the user.
53. Skip fully empty rows.
54. Convert numbers stored as text: "1,080", "£5.00", "5400 GBP".
55. Normalise Booking IDs ("bk-001 ") before linking items.
56. Flag duplicate Booking IDs; keep them as separate rows.
57. Flag items pointing to a missing booking.
58. Flag bookings with no items.
59. Flag the same SKU twice in one booking.
60. Missing required field = "cannot check", its own state, blocks shipping.
61. Flag a city that doesn't match its country (Info); use the country for the route.
62. One bad row never crashes the batch.

## C. Carrier recommendation
63. Route from destination country.
64. Total cost = pallets × price per pallet.
65. Filter carriers that can't take the weight, rank the rest by priority (see 23).
66. Tie-break order written into code.
67. Balanced = TOPSIS + marginal-value logic.
68. Every booking gets a recommendation, even with Red issues ("once fixed, use B because…").
69. Pallets missing/zero: show prices per pallet, no total.
70. Changing priority, pallets, weight or destination reruns the recommendation.

## D. Chat behaviour
71. Required fields as per the template (appointment for warehouse only).
72. Auto-fill: origin country UK, currency GBP, country from city when unique.
73. Business address: appointment = "No / not applicable" without asking.
74. IMPORTANT: a value the seller stated is kept as stated even if wrong; a value the bot calculated is marked "calculated, confirm?".
75. When the seller changes something, only calculated values update automatically (e.g. stated 90 cartons stays; flag R-04; ask "update the total to 120?").
76. Gross weight is never calculated; ask, or offer item weight + ~25 kg/pallet estimate that the seller must confirm.
77. Convert lb→kg, tonnes→kg, "boxes"→cartons, "pieces"→units, "5k"→5000.
78. City outside the list → reply listing allowed options; never guess.
79. Euros/dollars → ask for GBP; never convert.
80. Past ready date asked again straight away.
81. At most 3 questions per message; never re-ask something given.

## E. Output, documents and status
82. Each issue: what's wrong, severity, why it matters, how to fix — in words a seller understands.
83. Status: Blocked (any Red), Check (Amber only), Ready to ship.
84. Confirm disabled while anything is Red; Amber must be acknowledged before confirming.
85. "Apply all fixes" only applies tested number fixes; HS suggestions and dangerous-goods changes always need a human.
86. Commercial invoice: ask for missing fields or show clearly labelled placeholders. Cap or paginate carton labels PDF.
87. Delivery date states the working-days assumption; past ready date → collection = next working day from today.
88. Info note when a warehouse appointment date doesn't line up with the estimated arrival (if the seller gives a slot date).
