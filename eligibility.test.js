import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLeadEligibility } from "./eligibility.js";

test("accepts an explicit self-drive rental request", () => {
  const result = evaluateLeadEligibility(
    "Lf Van for rent po yung pwede po sana sa self drive 22-24 po irerent QC loc po."
  );

  assert.deepEqual(result, {
    eligible: true,
    reason: "explicit_rental_buyer_intent"
  });
});

test("accepts the supplied multiweek self-drive lead", () => {
  const result = evaluateLeadEligibility(
    [
      "Looking for",
      "-5 seater sedan",
      "-self drive",
      "-approx 2-3 weeks rental",
      "-Cavite/Las Piñas area"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: true,
    reason: "explicit_rental_buyer_intent"
  });
});

test("accepts the supplied lead when its opening phrase is missing", () => {
  const result = evaluateLeadEligibility(
    [
      "-5 seater sedan",
      "-self drive",
      "-approx 2-3 weeks rental",
      "-Cavite/Las Piñas area"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: true,
    reason: "rental_context_candidate"
  });
});

test("accepts an explicit rental request without driver wording", () => {
  const result = evaluateLeadEligibility(
    "Looking for a 7-seater car rental tomorrow in Taguig."
  );

  assert.deepEqual(result, {
    eligible: true,
    reason: "explicit_rental_buyer_intent"
  });
});

test("accepts a vehicle price inquiry without driver wording", () => {
  const result = evaluateLeadEligibility(
    "Mgkano po kaya 7 seaters 4d3n Manila to Calatagan Batangas para nextweek po"
  );

  assert.deepEqual(result, {
    eligible: true,
    reason: "explicit_rental_buyer_intent"
  });
});

test("accepts hm as a vehicle price inquiry", () => {
  const result = evaluateLeadEligibility(
    "Hello hm 4 seater Sampaloc Manila to Tagaytay 12hrs po"
  );

  assert.deepEqual(result, {
    eligible: true,
    reason: "explicit_rental_buyer_intent"
  });
});

test("accepts common English and Tagalog rental shorthand", () => {
  const examples = [
    "L/F 7str van Manila to Baguio tmr",
    "LF4 kotse w/ drv QC to Batangas",
    "LFR SUV rntl nxt wk",
    "ISO Hiace for 3d2n",
    "H/M po Innova Manila to Tagaytay",
    "How mch 5s sedan for 12h?",
    "Mag kano po Grandia RT Manila-Baguio?",
    "Mgkno 4-seater self drv 2wks",
    "Price pls NV350 p/u NAIA d/o Makati",
    "Rate po van w driver bukas",
    "Pa qoute SUV airport transfer",
    "Qte pls Avanza for weekend",
    "Any recos car rental po?",
    "May avl na kotse mamaya?",
    "Mron bang 6str to Batangas?",
    "Pahanap po sedan Cavite area",
    "Kelangan van balikan",
    "5str s/d 2wks rnt Cavite"
  ];

  for (const example of examples) {
    assert.equal(
      evaluateLeadEligibility(example).eligible,
      true,
      example
    );
  }
});

test("accepts a request allowing self-drive or with-driver options", () => {
  const result = evaluateLeadEligibility(
    "LF van, self drive or with driver is okay."
  );

  assert.deepEqual(result, {
    eligible: true,
    reason: "explicit_rental_buyer_intent"
  });
});

test("accepts common English and Taglish driver phrases", () => {
  const examples = [
    "LF car with driver tomorrow, Taguig to Batangas.",
    "May available bang van na may driver?",
    "Naghahanap ng 7-seater na kasamang driver.",
    "Need an SUV w/ driver for airport pickup."
  ];

  for (const example of examples) {
    assert.equal(
      evaluateLeadEligibility(example).eligible,
      true,
      example
    );
  }
});

test("accepts explicit rejection of self-drive when a driver is requested", () => {
  const result = evaluateLeadEligibility(
    "Not self drive please; looking for a car with driver."
  );

  assert.deepEqual(result, {
    eligible: true,
    reason: "explicit_rental_buyer_intent"
  });
});

test("rejects a passenger transport offer", () => {
  const result = evaluateLeadEligibility(
    "Looking for Passengers PAMPANGA to MANILA. Available tonight. Direct Driver."
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "passenger_or_driver_search"
  });
});

test("rejects a competitor advertisement offering cars with drivers", () => {
  const result = evaluateLeadEligibility(
    "Our fleet has clean vehicles with driver available. Book now. Driver's fee is 1,300/day."
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects an advertisement framed as a buyer question", () => {
  const result = evaluateLeadEligibility(
    "Are you looking for a car with driver? We offer affordable daily packages. Message us today."
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects the supplied provider advertisement", () => {
  const result = evaluateLeadEligibility(
    [
      "Arat na guys sa next destination.",
      "Car Rental",
      "VIOS & STAR GAZER",
      "2024 Latest Model",
      "Automatic Transmission",
      "4 TO-8 seaters",
      "Self drive or w/ Driver",
      "Owner Driver",
      "Rates Starts at 1200",
      "Lowest & Affordable Rates",
      "Rates excludes fuel, toll and parking fee",
      "2 valid Government IDs",
      "Proof of Billing with complete address",
      "Accept advance booking",
      "Available everyday",
      "DM for booking",
      "Angeles City, Pampanga"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects a promo-rate ad asking renters to message its Facebook page", () => {
  const result = evaluateLeadEligibility(
    [
      "₱1500 lang ANYWHERE in Luzon??? Sulit na sulit",
      "Mag-rent na kayo habang pasabog ang promo!",
      "PM our FB page po.",
      "CAR FOR RENT",
      "SELF DRIVE",
      "WITH DRIVER",
      "RFID-READY",
      "Promo rate is ₱1,500 per 24 hours ANYWHERE in Luzon.",
      "Well-maintained unit",
      "Ready Ride Package",
      "Take advantage niyo na po ang promo while it’s still on.",
      "PM our Facebook page to book your travel dates.",
      "#carforrent #carrental #carrentalservice #selfdrive",
      "#carforrentmontalban #montalbancarforrent"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects a monthly-rental promotion framed as a renter question", () => {
  const result = evaluateLeadEligibility(
    [
      "BIG DISCOUNT FOR BERMONTHS PROMO",
      "Landing in Manila? Skip the Grab queues.",
      "Your rental car can be delivered directly to NAIA.",
      "Monthly Car Rental No Long-Term Commitment",
      "Perfect for:",
      "Expats staying in Manila for a few weeks or months",
      "OFWs visiting the Philippines for an extended stay",
      "Companies needing vehicles for employees",
      "Employees on temporary assignments",
      "Insurance replacement rentals",
      "Flexible monthly rentals.",
      "No need to commit to a long-term lease.",
      "NAIA delivery available",
      "Flexible rental periods",
      "Need a car for a month — or just until you get your own back?",
      "Ask about our monthly rental options today.",
      "#carrental #rentacar #TaguigCarRental #selfdrive",
      "#carrentalservice #CarRentalWithDriver"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects a provider ad written with decorative Unicode text", () => {
  const result = evaluateLeadEligibility(
    [
      "𝐖𝐄 𝐒𝐓𝐈𝐋𝐋 𝐇𝐀𝐕𝐄 𝐀𝐕𝐀𝐈𝐋𝐀𝐁𝐋𝐄 𝐔𝐍𝐈𝐓𝐒 𝐅𝐎𝐑 𝐓𝐇𝐈𝐒 𝐖𝐄𝐄𝐊𝐄𝐍𝐃! 𝐁𝐎𝐎𝐊 𝐍𝐎𝐖!",
      "PRIMO AND PEARL ARE AVAILABLE FOR RENT!",
      "Car Rental",
      "Available for:",
      "Daily Rental",
      "Weekly Rental",
      "Monthly Rental",
      "Peak season slots are limited — reserve yours now!",
      "Wag kana mahiya! PM NA!"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects the supplied repeat-client provider advertisement", () => {
  const result = evaluateLeadEligibility(
    [
      "Price starts @ 999",
      "Special Discount for OFW's and Balikbayans",
      "BACK-TO-BACK REPEAT CLIENT!",
      "Thank you, Sir Kiko, for trusting Preemo Car Rental Service once again!",
      "Unit Delivered to Sto. Rosario, Angeles City",
      "Booked for 24hrs",
      "Enjoy our EXCLUSIVE DISCOUNTS for:",
      "Daily Rentals",
      "Weekly Rentals",
      "Monthly Rentals",
      "Send DM to check our available rates and units."
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects the supplied promotional vehicle advertisement", () => {
  const result = evaluateLeadEligibility(
    [
      "AVAILABLE NOW! MITSUBISHI XPANDER GLS 2026 | QUARTZ PEARL WHITE",
      "your sleek, stylish, and super comfy ride!",
      "Ready to roll whenever you need! book early to secure your date!",
      "WHY YOU’LL LOVE RIDING WITH US:",
      "Spacious 7-seater — fits your whole family or group",
      "SUPER COLD AIRCON",
      "Well-maintained, sanitized, and always ready to serve!",
      "Ideal for family outings, road trips, weddings, birthdays, airport transfers",
      "Promos for renting more than one day",
      "Just let us know.",
      "Looking forward to serving you and being your go-to ride for your future plans!"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects the supplied seller-profile advertisement", () => {
  const result = evaluateLeadEligibility(
    [
      "SELFDRIVE OR WITH DRIVER.",
      "Wherever you're headed — for business, errands, out-of-town trips, weekend getaways, or airport transfers",
      "Toyota Innova (7-8 SEATER)",
      "Toyota Avanza",
      "Honda Mobilio",
      "Van with Driver Only",
      "WHY RIDE WITH BUDDYMOTO?",
      "Self-drive or with professional driver",
      "Clean & well-maintained units",
      "Airport transport available",
      "FREE delivery within Lucena",
      "0997 556 7447",
      "Ride with Buddy.",
      "#BuddymotoCarRentalLucena #LucenaCarRental #QuezonCarRental"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects a van-for-rent service advertisement with phone numbers", () => {
  const result = evaluateLeadEligibility(
    [
      "VAN FOR RENT",
      "TOYOTA HI ACE",
      "For any occasions/events:",
      "Out of town tours",
      "Airport hatid sundo",
      "Family outings or reunions",
      "Company outings/teambuildings",
      "And More",
      "With own driver",
      "No to self drive",
      "Affordable rates",
      "call",
      "09637813746",
      "09944094972"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects a door-to-door transport service menu", () => {
  const result = evaluateLeadEligibility(
    [
      "DOOR TO DOOR SERVICE",
      "Van and SUV",
      "Daily Byahe Vice Versa",
      "Manila to Naga",
      "Manila to Legazpi / Daraga",
      "Manila to Tabaco",
      "Manila to Pilar Sorsogon",
      "Manila to Pioduran",
      "Manila to Sorsogon City",
      "Manila to Bulan",
      "Manila to Matnog",
      "Pampanga",
      "Bulacan",
      "Manila",
      "Calabarzon",
      "Camarines Sur",
      "Camarines Norte",
      "ALBAY",
      "Sorsogon",
      "Pasahero Pasabay",
      "Arkila / Semi Arkila",
      "Pet Padala",
      "Bagahe Padala",
      "DOCS Padala",
      "Sundo / Hatid Airport (Naia Terminal)",
      "FREE ADVANCE BOOKING",
      "NO ADVANCE FEE / NO RESERVATION FEE",
      "STRICTLY NO CANCELLATION",
      "NO DOUBLE BOOKING",
      "pm or call --09481326458",
      "Safe and Legit since 2020"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects an available-self-drive capacity advertisement", () => {
  const result = evaluateLeadEligibility(
    [
      "AVAILABLE SELFDRIVE",
      "5-Seaters",
      "7-Seaters",
      "15-16-Seaters",
      "0939-185-4635"
    ].join("\n")
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "provider_advertisement"
  });
});

test("rejects combined provider booking and rate signals", () => {
  const examples = [
    "Vios rates start at 1200. DM for booking.",
    "Owner driver. Available everyday. Accept advance booking.",
    "Self drive or with driver. Requirements: 2 valid government IDs and proof of billing."
  ];

  for (const example of examples) {
    assert.deepEqual(
      evaluateLeadEligibility(example),
      {
        eligible: false,
        reason: "provider_advertisement"
      },
      example
    );
  }
});

test("does not reject a buyer for one ambiguous booking phrase", () => {
  assert.deepEqual(
    evaluateLeadEligibility(
      "Do you accept advance booking for a Vios tomorrow?"
    ),
    {
      eligible: true,
      reason: "rental_context_candidate"
    }
  );
});

test("allows buyer contact details without treating them as an ad", () => {
  assert.deepEqual(
    evaluateLeadEligibility(
      "LF Vios with professional driver tomorrow. Contact 0997 556 7447."
    ),
    {
      eligible: true,
      reason: "explicit_rental_buyer_intent"
    }
  );
});

test("allows a buyer to state a per-day budget", () => {
  assert.deepEqual(
    evaluateLeadEligibility(
      "LF car tomorrow, budget ₱1,500 per day. Please message me."
    ),
    {
      eligible: true,
      reason: "explicit_rental_buyer_intent"
    }
  );
});

test("allows a buyer asking for a one-month rental", () => {
  assert.deepEqual(
    evaluateLeadEligibility(
      "Need a car for one month starting October 1. Manila area po."
    ),
    {
      eligible: true,
      reason: "explicit_rental_buyer_intent"
    }
  );
});

test("allows a direct buyer request containing weak provider-like wording", () => {
  assert.deepEqual(
    evaluateLeadEligibility(
      "LF van for rent with driver, affordable rate sana. Contact 0997 556 7447."
    ),
    {
      eligible: true,
      reason: "explicit_rental_buyer_intent"
    }
  );
});

test("accepts buyer intent written with decorative Unicode text", () => {
  assert.deepEqual(
    evaluateLeadEligibility("𝐋𝐅 𝐕𝐢𝐨𝐬 tomorrow for 12 hours"),
    {
      eligible: true,
      reason: "explicit_rental_buyer_intent"
    }
  );
});

test("rejects a vehicle mention without buyer intent", () => {
  const result = evaluateLeadEligibility(
    "Saw a nice seven-seater vehicle in Taguig yesterday."
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "no_explicit_buyer_intent"
  });
});

test("rejects vehicle sale and purchase shorthand", () => {
  const examples = [
    "WTB Vios 2022 model",
    "WTS Innova for sale",
    "FS Honda City, HM 500k",
    "Fortuner WTT for SUV"
  ];

  for (const example of examples) {
    assert.deepEqual(
      evaluateLeadEligibility(example),
      {
        eligible: false,
        reason: "vehicle_sale_or_purchase"
      },
      example
    );
  }
});
