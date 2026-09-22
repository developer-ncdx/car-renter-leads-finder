import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateJobEligibility,
  hasDirectTargetedHiringIntent
} from "./job-eligibility.js";

test("accepts hiring posts for every configured job family", () => {
  const examples = [
    "We're hiring an AI Engineer for a remote full-time role.",
    "Looking for a Bubble.io developer to join our team.",
    "Software developer position available. Apply now.",
    "Hiring: Web Developer – 1 Position. Join our team in Manila.",
    "We're hiring a frontend developer for our website.",
    "Backend engineer position available.",
    "Seeking a full-stack developer for a contract role.",
    "Hiring an AI agent developer for a new product.",
    "Agentic AI developer needed for a contract role.",
    "Seeking an AI-assisted developer for our internal tools.",
    "AI specialist vacancy, hybrid setup in Makati.",
    "Automation engineer wanted for a full-time position.",
    "Need an automation dev for a freelance project."
  ];

  for (const example of examples) {
    assert.deepEqual(
      evaluateJobEligibility(example),
      {
        eligible: true,
        reason: "targeted_job_opening"
      },
      example
    );
  }
});

test("accepts common role abbreviations and Bubble variants", () => {
  const examples = [
    "Now hiring: AI Engr, remote role.",
    "SWE job opening — applications are open.",
    "Need a dev for Bubble.io for a part-time project.",
    "Hiring LLM developer. Apply today.",
    "𝐖𝐄 𝐀𝐑𝐄 𝐇𝐈𝐑𝐈𝐍𝐆: 𝐀𝐈 𝐄𝐍𝐆𝐈𝐍𝐄𝐄𝐑"
  ];

  for (const example of examples) {
    assert.equal(evaluateJobEligibility(example).eligible, true, example);
  }
});

test("treats short targeted hiring captions as explicit", () => {
  const examples = [
    "Looking for software engineer",
    "Looking for software engineer Chlarenz Terrones",
    "Need AI engineer",
    "Hiring Bubble developer",
    "Automation developer needed"
  ];

  for (const example of examples) {
    assert.equal(
      hasDirectTargetedHiringIntent(example),
      true,
      example
    );
    assert.equal(evaluateJobEligibility(example).eligible, true, example);
  }
});

test("rejects job seekers for target roles", () => {
  const examples = [
    "AI engineer open to work. Here is my portfolio.",
    "Hire me as your Bubble developer.",
    "Automation developer available for work.",
    "Looking for clients as a software developer.",
    "Looking for software engineer job.",
    "Looking for a web developer job."
  ];

  for (const example of examples) {
    assert.deepEqual(
      evaluateJobEligibility(example),
      {
        eligible: false,
        reason: "job_seeker_post"
      },
      example
    );
  }
});

test("rejects courses and service advertisements", () => {
  const examples = [
    "Enroll now in our AI Engineer bootcamp.",
    "We offer automation developer services. Book a call.",
    "Bubble.io developer tutorial and certification webinar."
  ];

  for (const example of examples) {
    assert.deepEqual(
      evaluateJobEligibility(example),
      {
        eligible: false,
        reason: "service_or_training_ad"
      },
      example
    );
  }
});

test("rejects unrelated jobs and role discussions", () => {
  assert.deepEqual(
    evaluateJobEligibility("We're hiring an accountant in Manila."),
    {
      eligible: false,
      reason: "no_target_job_role"
    }
  );

  assert.deepEqual(
    evaluateJobEligibility("What skills should an AI engineer learn?"),
    {
      eligible: false,
      reason: "no_explicit_hiring_intent"
    }
  );
});
