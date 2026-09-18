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
