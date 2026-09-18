const TARGET_ROLE_PATTERN =
  /\b(?:(?:ai|a\.i\.|artificial\s+intelligence|machine\s+learning|ml|llm|gen(?:erative)?\s*ai)\s+(?:engineers?|engrs?|developers?|devs?|specialists?)|bubble(?:\.io)?\s+(?:developers?|devs?|engineers?|specialists?)|(?:developers?|devs?|engineers?|specialists?)\s+(?:for\s+)?bubble(?:\.io)?|software\s+(?:developers?|devs?|engineers?)|swe|sde|(?:ai\s+)?agents?\s+(?:developers?|devs?|engineers?|specialists?)|agentic(?:\s+ai)?\s+(?:developers?|devs?|engineers?|specialists?)|ai[\s-]*assisted\s+(?:developers?|devs?|engineers?|specialists?)|automation\s+(?:developers?|devs?|engineers?|specialists?))\b/i;

const HIRING_INTENT_PATTERN =
  /\b(?:we(?:'re|\s+are)?\s+hiring|now\s+hiring|hiring|job\s+openings?|openings?\s+for|vacanc(?:y|ies)|positions?\s+(?:available|open)|seeking|looking\s+for|need(?:ed)?|wanted|join\s+our\s+team|apply\s+(?:now|here|today)|applications?\s+(?:open|accepted)|recruiting|full[\s-]*time|part[\s-]*time|contract(?:or)?|freelance\s+(?:role|project|opportunity)|remote\s+(?:role|job|position)|hybrid\s+(?:role|job|position)|salary|pay\s+range)\b/i;

const JOB_SEEKER_PATTERN =
  /\b(?:open\s+to\s+work|hire\s+me|available\s+for\s+(?:work|hire|projects?)|looking\s+for\s+(?:a\s+)?(?:job|work|clients?|opportunit(?:y|ies))|seeking\s+(?:a\s+)?(?:job|work|clients?|opportunit(?:y|ies))|my\s+(?:cv|resume|résumé|portfolio)|here(?:'s|\s+is)\s+my\s+(?:cv|resume|résumé|portfolio)|looking\s+for\s+clients?|accepting\s+(?:clients?|projects?))\b/i;

const SERVICE_OR_TRAINING_PATTERN =
  /\b(?:course|bootcamp|webinar|workshop|training|certification|tutorial|masterclass|enroll\s+now|we\s+(?:offer|provide)\s+.{0,40}\bservices?|hire\s+us|book\s+(?:a\s+)?call|dm\s+us\s+for\s+.{0,40}\bservices?)\b/i;

export function evaluateJobEligibility(postText) {
  const text = String(postText ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return {
      eligible: false,
      reason: "empty_post_text"
    };
  }

  if (!TARGET_ROLE_PATTERN.test(text)) {
    return {
      eligible: false,
      reason: "no_target_job_role"
    };
  }

  if (JOB_SEEKER_PATTERN.test(text)) {
    return {
      eligible: false,
      reason: "job_seeker_post"
    };
  }

  if (SERVICE_OR_TRAINING_PATTERN.test(text)) {
    return {
      eligible: false,
      reason: "service_or_training_ad"
    };
  }

  if (!HIRING_INTENT_PATTERN.test(text)) {
    return {
      eligible: false,
      reason: "no_explicit_hiring_intent"
    };
  }

  return {
    eligible: true,
    reason: "targeted_job_opening"
  };
}
