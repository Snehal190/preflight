// The template's example row (spec §2.4). Used to skip the example in uploads (spec §5.2 rule 5)
// and as the reference unit test. Values are exactly as they appear in the template.

export const EXAMPLE_BOOKING_ROW: Readonly<Record<string, string>> = {
  "Booking ID": "BK-001",
  "Seller name": "Northfield Goods",
  Origin: "Manchester, United Kingdom",
  Destination: "Frankfurt, Germany",
  "Destination type": "Warehouse",
  "Ready to ship date": "05-11-2026",
  "Seller priority": "Cheapest",
  Pallets: "3",
  Cartons: "90",
  "Total declared value": "5400",
  Currency: "GBP",
  "Total gross weight (kg)": "620",
  "Delivery appointment booked": "Yes",
};

export const EXAMPLE_ITEM_ROW: Readonly<Record<string, string>> = {
  "Booking ID": "BK-001",
  SKU: "MUG-01",
  Description: "Ceramic coffee mug, 350 ml",
  "HS code": "691200",
  Quantity: "1080",
  "Unit price": "5.00",
  "Units per carton": "12",
  Cartons: "90",
  "Unit weight (kg)": "0.5",
  "Country of origin": "United Kingdom",
};
