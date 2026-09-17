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
