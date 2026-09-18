const NON_RENTER_PATTERN =
  /\b(?:looking\s+for|lf|need(?:ed)?)\s+(?:\d+\s+)?(?:passengers?|joiners?)\b|\b(?:passengers?|joiners?)\s+(?:needed|wanted)\b|\b(?:hiring|looking\s+for|lf)\s+(?:a\s+)?drivers?\b|\bdriver\s+(?:hiring|job|applicant)\b/i;

const PROVIDER_OFFER_PATTERN =
  /\bour\s+(?:fleet|units?|cars?|vehicles?|rates?|services?)\b|\bwe\s+(?:offer|provide|accept|have\s+available)\b|\bwe\s+(?:still\s+)?have\s+(?:available\s+)?units?\b|\b(?:accepting|open\s+for)\s+(?:advance\s+)?bookings?\b|\b(?:book|reserve)\s+now\b|\b(?:reserve|secure)\s+(?:yours?|your\s+(?:ride|unit|slot))\s+now\b|\bfor\s+(?:reservations?|inquiries)(?:\s+or\s+(?:reservations?|inquiries))?\b|\b(?:text|call)(?:\s+or\s+(?:text|call))?\s+for\s+(?:bookings?|reservations?|inquiries)\b|\b(?:send|message|contact|pm)\s+us\b|\bwhy\s+choose\s+us\b|\bdriver'?s\s+fee\b|\b(?:daily|weekly|monthly|hourly)\s+rates?\b|\blowest\s+(?:car\s+rental\s+)?rates?\b|\bbooking\s+slots?\b|\bavailable\s+on\s+(?:whatsapp|viber|telegram)\b|\b(?:rent|book)\s+with\s+us\b/i;

const STRONG_PROVIDER_AD_PATTERN =
  /\b(?:rates?|prices?)\s+(?:start|starts|starting)\s+(?:at|from|@)\s+(?:₱|php|p)?\s*\d|\b(?:dm|pm|message|contact)\s+(?:(?:me|us)\s+)?for\s+(?:bookings?|reservations?|rates?|details?|inquiries)\b/i;

const PROVIDER_AD_SIGNAL_PATTERNS = Object.freeze([
  /\b(?:accept|accepts|accepting|taking)\s+(?:advance\s+)?bookings?\b/i,
  /\b(?:dm|pm|message|contact)\s+(?:(?:me|us)\s+)?for\s+(?:bookings?|reservations?|rates?|details?|inquiries)\b/i,
  /\b(?:rates?|prices?)\s+(?:start|starts|starting)\s+(?:at|from|@)\s+(?:₱|php|p)?\s*\d/i,
  /\blowest\b.{0,40}\b(?:rates?|prices?)\b/i,
  /\bavailable\s+(?:every\s*day|everyday|daily|24\s*\/?\s*7)\b/i,
  /\b(?:owner[\s-]*driver|legit\s+(?:and|&)\s+trusted\s+driver)\b/i,
  /\bvalid\s+government\s+ids?\b/i,
  /\b(?:proof\s+of\s+billing|selfie\s+with\s+id)\b/i,
  /\brates?\s+excludes?\s+(?:fuel|tolls?|parking)\b/i,
  /\bavailable\s+units?\b|\bunits?\s+(?:are\s+)?available\b/i,
  /\bavailable\s+for\s+(?:daily|weekly|monthly)\s+rentals?\b/i,
  /\b(?:daily|weekly|monthly)\s+rentals?\b/i,
  /\b(?:pm|dm)\s+(?:na|now)\b/i,
  /\b(?:special|exclusive|repeat-client|long[\s-]*term)\s+discounts?\b/i,
  /\b(?:unit|vehicle|car)\s+(?:was\s+)?delivered\b|\bbooked\s+for\s+\d+\s*(?:h|hrs?|hours?)\b/i,
  /\bthank\s+you\b.{0,100}\b(?:trusting|choosing)\b.{0,100}\b(?:rental|service)\b/i,
  /\bsend\s+(?:a\s+)?(?:dm|pm)\s+to\s+(?:check|ask|see)\b/i,
  /\bour\s+available\s+(?:rates?|units?)(?:\s+and\s+(?:rates?|units?))?\b/i,
  /\bavailable\s+(?:now|today|this\s+(?:week|weekend|month))\b/i,
  /\bbook\s+(?:early|ahead|in\s+advance)\b|\bsecure\s+your\s+(?:date|slot|booking|ride)\b/i,
  /\bwhy\s+you(?:['’]ll|\s+will)\s+love\b|\b(?:ride|rent|book)\s+with\s+us\b/i,
  /\b(?:ready|happy)\s+to\s+serve\b|\bserving\s+you\b|\bgo-to\s+ride\b/i,
  /\b(?:promos?|discounts?)\s+for\s+(?:renting|booking)\b/i,
  /\b(?:well[\s-]*maintained|sanitized|cold\s+aircon|fuel[\s-]*efficient)\b/i,
  /\bjust\s+(?:let\s+us\s+know|message\s+us|pm\s+us)\b/i,
  /\bwhy\s+(?:ride|rent|book|choose)\s+with\b/i,
  /\bprofessional\s+drivers?\b/i,
  /\bfree\s+(?:delivery|pick[\s-]*up|drop[\s-]*off)\b/i,
  /\b(?:airport\s+transport|transport\s+service)\s+available\b/i,
  /\b(?:\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/i,
  /(?:#[a-z0-9_]+\s*){2,}/i
]);

const VEHICLE_PATTERN_SOURCE =
  String.raw`(?:cars?|kots?e|koche|autos?|vans?|suvs?|mpvs?|auvs?|uvs?|sedans?|vehicles?|sasakyans?|saskyan|transport(?:ation)?|pick[\s-]*ups?|mini[\s-]*vans?|coasters?|buses?|jeeps?|(?:[2-9]|[1-5]\d)[\s-]*(?:seaters?|str|s)|innova|avanza|vios|ertiga|xpander|fortuner|hi[\s-]*ace|grandia|commuter|urvan|nv[\s-]*350|starex|montero|everest|terra|mirage|wigo|raize|rush|br[\s-]*v|cr[\s-]*v|almera|honda[\s-]*city|l[\s-]*300|apv|revo|adventure|crosswind|jimny|hilux|navara|ranger)`;

const VEHICLE_MODEL_NAME_PATTERN =
  /\b(?:innova|avanza|vios|ertiga|xpander|fortuner|hi[\s-]*ace|grandia|commuter|urvan|nv[\s-]*350|starex|montero|everest|terra|mirage|wigo|raize|rush|br[\s-]*v|cr[\s-]*v|almera|honda[\s-]*city|mobilio|l[\s-]*300|apv|revo|adventure|crosswind|jimny|hilux|navara|ranger)\b/gi;

const SEARCH_INTENT_PATTERN_SOURCE =
  String.raw`(?:l[\s./-]*f(?:\s*4)?|lfr|iso|lookin(?:g)?\s*(?:for|4)|need(?:ed)?|seeking|wanted|hanap|nag[\s-]*hahanap|pa[\s-]*hanap|pahanap|kailangan|kelangan|klangan|gusto(?:\s+ko)?|balak)`;

const PRICE_INQUIRY_PATTERN_SOURCE =
  String.raw`(?:h[\s./-]*m|how\s*m(?:u)?ch|m(?:a)?g[\s-]*k(?:a)?no|prices?|prce|presyo|rates?|quotes?|quotations?|qoutes?|qotations?|qoutations?|qte|l[\s./-]*p)`;

const AVAILABILITY_PATTERN_SOURCE =
  String.raw`(?:avail(?:able|ability)?|avl|bakante)`;

const RECOMMENDATION_PATTERN_SOURCE =
  String.raw`(?:rec(?:o(?:s)?)?|recommend(?:ation)?s?|suggest(?:ion)?s?|referrals?|pa[\s-]*reco)`;

const RENTAL_CONTEXT_PATTERN_SOURCE =
  String.raw`(?:rent(?:al|ed|ing)?|rnt|rntl|hire|self[\s-]*(?:drive|drv)|s[\s./-]*d|w(?:ith|\/)?\s*(?:a\s+)?(?:driver|drv)|w\s*\/?\s*o\s+(?:driver|drv)|chauffeur(?:ed|-driven)?|arkila|umarkila|mag[\s-]*arkila|upa|umupa|mag[\s-]*upa|mauupahan|marerentahan|rentahan)`;

const TRIP_DETAIL_PATTERN_SOURCE =
  String.raw`(?:today|tomorrow|tmrw|tmr|tonight|weekends?|n(?:e)?xt\s+w(?:ee)?k|bukas|bks|mamaya|ngayon|round[\s-]*trip|r\s*\/?\s*t|one[\s-]*way|o\s*\/?\s*w|balikan|hatid[\s-]*sundo|pick[\s-]*up|p\s*\/?\s*u|drop[\s-]*off|d\s*\/?\s*o|airport\s+transfer|tour|outing|(?:\d{1,2})\s*(?:h|hrs?|hours?|d|days?|wks?|weeks?|mos?|months?)|(?:\d{1,2})d(?:\d{1,2})n|(?:from|frm|mula|galing)\b.{0,60}\b(?:to|papunta)|(?:to|papunta|bound\s+for)\b)`;

const VEHICLE_SALE_PATTERN = new RegExp(
  [
    String.raw`\b(?:wtb|wts|want\s+to\s+(?:buy|sell)|buying|for\s+sale|fs|for\s+trade|wtt)\b.{0,100}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,100}\b(?:for\s+sale|fs|for\s+trade|wtt)\b`
  ].join("|"),
  "i"
);

const BUYER_INTENT_PATTERN = new RegExp(
  [
    String.raw`\b${SEARCH_INTENT_PATTERN_SOURCE}\b.{0,100}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,100}\b${SEARCH_INTENT_PATTERN_SOURCE}\b`,
    String.raw`\b${PRICE_INQUIRY_PATTERN_SOURCE}\b.{0,120}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,120}\b${PRICE_INQUIRY_PATTERN_SOURCE}\b`,
    String.raw`\b(?:may|mayroon(?:g)?|m(?:e)?ron(?:g)?|any)\b.{0,80}\b(?:${AVAILABILITY_PATTERN_SOURCE}\b.{0,40}\b)?${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${AVAILABILITY_PATTERN_SOURCE}\b.{0,80}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,80}\b${AVAILABILITY_PATTERN_SOURCE}\b(?:.{0,20}\b(?:ba|po)\b)?`,
    String.raw`\b${RECOMMENDATION_PATTERN_SOURCE}\b.{0,80}\b(?:${VEHICLE_PATTERN_SOURCE}|car\s+rental)\b`,
    String.raw`\b(?:pa[\s-]*quote|pa[\s-]*quotation|request(?:ing)?\s+(?:a\s+)?quote)\b.{0,100}\b${VEHICLE_PATTERN_SOURCE}\b`,
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,100}\b(?:pa[\s-]*quote|pa[\s-]*quotation|request(?:ing)?\s+(?:a\s+)?quote)\b`
  ].join("|"),
  "i"
);

const RENTAL_CONTEXT_PATTERN = new RegExp(
  [
    String.raw`\b${VEHICLE_PATTERN_SOURCE}\b.{0,160}\b(?:${RENTAL_CONTEXT_PATTERN_SOURCE}|${TRIP_DETAIL_PATTERN_SOURCE})\b`,
    String.raw`\b(?:${RENTAL_CONTEXT_PATTERN_SOURCE}|${TRIP_DETAIL_PATTERN_SOURCE})\b.{0,160}\b${VEHICLE_PATTERN_SOURCE}\b`
  ].join("|"),
  "i"
);

export function evaluateLeadEligibility(postText) {
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

  if (NON_RENTER_PATTERN.test(text)) {
    return {
      eligible: false,
      reason: "passenger_or_driver_search"
    };
  }

  if (VEHICLE_SALE_PATTERN.test(text)) {
    return {
      eligible: false,
      reason: "vehicle_sale_or_purchase"
    };
  }

  const hasExplicitBuyerIntent = BUYER_INTENT_PATTERN.test(text);
  const vehicleModels = new Set(
    (text.match(VEHICLE_MODEL_NAME_PATTERN) ?? [])
      .map((value) => value.toLowerCase().replace(/\s+/g, ""))
  );
  const providerAdSignalCount = PROVIDER_AD_SIGNAL_PATTERNS
    .filter((pattern) => pattern.test(text))
    .length +
    Number(vehicleModels.size >= 2);
  const providerSignalThreshold = hasExplicitBuyerIntent ? 3 : 2;

  if (
    PROVIDER_OFFER_PATTERN.test(text) ||
    STRONG_PROVIDER_AD_PATTERN.test(text) ||
    providerAdSignalCount >= providerSignalThreshold
  ) {
    return {
      eligible: false,
      reason: "provider_advertisement"
    };
  }

  const hasRentalContext = RENTAL_CONTEXT_PATTERN.test(text);

  if (!hasExplicitBuyerIntent && !hasRentalContext) {
    return {
      eligible: false,
      reason: "no_explicit_buyer_intent"
    };
  }

  return {
    eligible: true,
    reason: hasExplicitBuyerIntent
      ? "explicit_rental_buyer_intent"
      : "rental_context_candidate"
  };
}
