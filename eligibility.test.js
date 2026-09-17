import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLeadEligibility } from "./eligibility.js";

test("rejects the observed self-drive false positive", () => {
  const result = evaluateLeadEligibility(
    "Lf Van for rent po yung pwede po sana sa self drive 22-24 po irerent QC loc po."
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "explicit_self_drive"
  });
});

test("rejects posts without an explicit driver requirement", () => {
  const result = evaluateLeadEligibility(
    "Looking for a 7-seater car rental tomorrow in Taguig."
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "no_explicit_driver_requirement"
  });
});

test("rejects an either-self-drive-or-with-driver request", () => {
  const result = evaluateLeadEligibility(
    "LF van, self drive or with driver is okay."
  );

  assert.deepEqual(result, {
    eligible: false,
    reason: "explicit_self_drive"
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
    reason: "explicit_buyer_with_driver"
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
