const SELF_DRIVE_PATTERN =
  /\bself[\s-]*drive\b|\bwithout\s+(?:a\s+)?driver\b|\bno\s+driver\b|\bwalang\s+driver\b/i;

const NEGATED_SELF_DRIVE_PATTERN =
  /\b(?:not|no|hindi|ayaw|ayoko(?:\s+ng)?|huwag|wag)\b.{0,24}\bself[\s-]*drive\b/i;

const NON_RENTER_PATTERN =
  /\b(?:looking\s+for|lf|need(?:ed)?)\s+(?:\d+\s+)?(?:passengers?|joiners?)\b|\b(?:passengers?|joiners?)\s+(?:needed|wanted)\b|\b(?:hiring|looking\s+for|lf)\s+(?:a\s+)?drivers?\b|\bdriver\s+(?:hiring|job|applicant)\b/i;

const PROVIDER_OFFER_PATTERN =
  /\bour\s+(?:fleet|units?|cars?|vehicles?|rates?|services?)\b|\bwe\s+(?:offer|provide|accept|have\s+available)\b|\b(?:accepting|open\s+for)\s+(?:advance\s+)?bookings?\b|\b(?:book|reserve)\s+now\b|\bfor\s+(?:reservations?|inquiries)(?:\s+or\s+(?:reservations?|inquiries))?\b|\b(?:text|call)(?:\s+or\s+(?:text|call))?\s+for\s+(?:bookings?|reservations?|inquiries)\b|\b(?:send|message|contact|pm)\s+us\b|\bwhy\s+choose\s+us\b|\bdriver'?s\s+fee\b|\b(?:daily|weekly|monthly|hourly)\s+rates?\b|\blowest\s+(?:car\s+rental\s+)?rates?\b|\bbooking\s+slots?\b|\bavailable\s+on\s+(?:whatsapp|viber|telegram)\b|\b(?:rent|book)\s+with\s+us\b/i;

const VEHICLE_PATTERN_SOURCE =
  String.raw`(?:car|van|suv|mpv|sedan|vehicle|sasakyan|(?:[4-9]|1[0-2])[\s-]*seaters?|innova|avanza|vios|ertiga|xpander|fortuner)`;

const BUYER_INTENT_PATTERN = new RegExp(
  [
    String.raw`\b(?:lf|looking\s+for|need(?:ed)?|seeking|wanted|hanap|naghahanap|kailangan)\b.{0,80}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,80}\b(?:needed|wanted|required|hanap|naghahanap|kailangan|sana)\b`,
    String.raw`\b(?:may|meron(?:g)?|any)\b.{0,24}\bavailable\b.{0,50}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,50}\bavailable\s+(?:po\s+)?ba\b`,
    String.raw`\b(?:may|meron(?:g)?)\b.{0,50}\b${VEHICLE_PATTERN_SOURCE}\b.{0,60}\b(?:ba|po)\b`,
    String.raw`\b(?:looking|want(?:ing)?|planning)\s+to\s+(?:rent|hire)\b.{0,50}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b(?:gusto|balak)\b.{0,30}\b(?:mag[\s-]*rent|umarkila|rent)\b.{0,50}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b(?:recommend|recommendation|recommendations|reco)\b.{0,60}\b(?:${VEHICLE_PATTERN_SOURCE}|car\s+rental)\b`,
    String.raw`\b(?:how\s+much|magkano|mgkano)\b.{0,100}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,100}\b(?:how\s+much|magkano|mgkano)\b`,
    String.raw`\b(?:pa[\s-]*quote|pa[\s-]*quotation|request(?:ing)?\s+(?:a\s+)?quote)\b.{0,100}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,100}\b(?:pa[\s-]*quote|pa[\s-]*quotation|request(?:ing)?\s+(?:a\s+)?quote)\b`
  ].join("|"),
  "i"
);

export function evaluateLeadEligibility(postText) {
  const text = String(postText ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return {
      eligible: false,
      reason: "empty_post_text"
    };
  }

  const requestsSelfDrive =
    SELF_DRIVE_PATTERN.test(text) &&
    !NEGATED_SELF_DRIVE_PATTERN.test(text);

  if (requestsSelfDrive) {
    return {
      eligible: false,
      reason: "explicit_self_drive"
    };
  }

  if (NON_RENTER_PATTERN.test(text)) {
    return {
      eligible: false,
      reason: "passenger_or_driver_search"
    };
  }

  if (PROVIDER_OFFER_PATTERN.test(text)) {
    return {
      eligible: false,
      reason: "provider_advertisement"
    };
  }

  if (!BUYER_INTENT_PATTERN.test(text)) {
    return {
      eligible: false,
      reason: "no_explicit_buyer_intent"
    };
  }

  return {
    eligible: true,
    reason: "explicit_rental_buyer_intent"
  };
}
