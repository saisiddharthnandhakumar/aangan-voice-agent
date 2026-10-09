/**
 * Every qualification threshold in one place (PRD section 3), so Nikhil can change them
 * without touching logic. Internal pricing figures are NOT here: they come from
 * PRICING_CONFIG_JSON at runtime (see ./pricing.ts), because this repository is public.
 *
 * Values marked "PRD default" are the defaults from PRD section 5 "Open decisions",
 * approved for the build on 2026-10-10 pending Nikhil's confirmation.
 */
export const RULES_CONFIG = {
  budget: {
    /** A volunteered budget under this share of the floor fails (PRD default 70%). */
    failBelowRatio: 0.7,
    /** Assumed designed carpet area when only BHK is known (PRD default). 5BHK+ uses the 4BHK figure. */
    assumedSqftByBhk: { 1: 550, 2: 900, 3: 1150, 4: 2000 } as Record<number, number>,
    /** Numbers below this are taken to be lakh, not rupees (a voice model saying "1.5" for 1.5 lakh). */
    lakhInterpretationBelow: 1000,
  },

  timeline: {
    /** Completion needed in under this many weeks: fail (PRD; services.md minimum lead time). */
    failUnderWeeks: 6,
    /** Completion needed in under this many weeks (but not failing): Amber via "unclear" (PRD default). */
    amberUnderWeeks: 10,
  },

  commercial: {
    /** About 3,000 sq ft: services.md. Above it, flag size_above_commercial_limit. */
    maxSqft: 3000,
    /** About 500 sq ft: desk practice (T18), not in services.md. Below it, flag commercial_below_minimum (PRD default Amber). */
    minSqft: 500,
  },

  residential: {
    /** services.md: full home from 2BHK. A smaller full home is flagged small_residential (PRD default Amber). */
    minFullHomeBhk: 2,
  },

  priority: {
    /** High priority at or above this estimated project value (PRD section 3, step 6). */
    highValueInr: 4_000_000,
  },

  repeat: {
    /** Calls from the same number within this window link to the earlier call (P6). */
    windowHours: 24,
  },

  /** Out-of-scope project types: criterion 1 fails whatever the agent recorded (services.md). */
  outOfScopeProjectTypes: ["retail", "hospitality", "gym"] as const,

  /** Commercial project types use the commercial floor and limits. */
  commercialProjectTypes: ["office", "clinic", "studio"] as const,
} as const;

/**
 * Service area (criterion 2). `listed` is services.md word for word. `extended` adds common
 * Pune city and PCMC localities so real Pune callers are not flagged unlisted_locality
 * (proposal e9, approved). `excluded` names places services.md rules out, plus other cities.
 * Matching is whole-word on normalised text, so "Dahanukar Colony, Kothrud" matches "kothrud".
 */
export const SERVICE_AREA = {
  listed: [
    "kothrud", "baner", "aundh", "wakad", "koregaon park", "kalyani nagar", "viman nagar", "hadapsar",
    "magarpatta", "nibm", "kondhwa", "undri", "shivane", "warje", "erandwane", "deccan",
    "pimpri", "chinchwad", "pimple saudagar", "pimple nilakh", "ravet", "hinjewadi",
  ],
  extended: [
    "kharadi", "wagholi", "nanded city", "bavdhan", "pashan", "sus", "balewadi", "mahalunge",
    "yerawada", "yerwada", "camp", "shivajinagar", "shivaji nagar", "model colony", "sadashiv peth", "kasba peth",
    "narayan peth", "shaniwar peth", "bibwewadi", "katraj", "dhanori", "lohegaon", "vishrantwadi", "mundhwa",
    "keshav nagar", "wanowrie", "fatima nagar", "salunke vihar", "sinhagad road", "dhayari", "ambegaon",
    "karve nagar", "karvenagar", "bhosari", "akurdi", "nigdi", "tathawade", "punawale", "moshi", "chikhali",
    "thergaon", "rahatani", "kasarwadi", "dapodi", "sangvi", "pimple gurav", "bopodi", "khadki", "kirkee",
    "boat club", "senapati bapat", "prabhat road", "law college road", "swargate", "amanora", "cybercity",
    "cyber city", "pisoli", "mohammadwadi", "uttam nagar", "dhankawadi", "sahakar nagar", "parvati",
    "gultekdi", "market yard", "bund garden", "east street", "baner road", "pashan road",
    "aundh road", "kalyaninagar", "vimannagar", "magarpatta city", "hinjawadi", "wakad road",
    "bhugaon", "kothrud depot", "nibm road", "kondhwa budruk", "kondhwa khurd", "fursungi", "manjri",
  ],
  excluded: [
    "talegaon", "lonavala", "lonavla", "nashik", "mumbai", "navi mumbai", "thane", "satara", "kolhapur",
    "nagpur", "aurangabad", "chhatrapati sambhajinagar", "ahmednagar", "solapur", "sangli", "goa", "bangalore",
    "bengaluru", "hyderabad", "delhi", "chennai", "kolkata", "ahmedabad", "panvel", "alibag", "khandala",
  ],
  /** A bare city name: inside the area but no locality given, so it passes without a flag. */
  generic: ["pune", "pune city", "pcmc", "pimpri chinchwad", "pimpri-chinchwad"],
  /** Pune city and PCMC pincodes start 411. Others (412, 410...) are treated as unlisted, not failed. */
  punePincodePrefix: "411",
} as const;

/** Exact wording the agent speaks. No figures, ever. */
export const WORDING = {
  /** pricing.md, the only acceptable response to a pricing question. */
  pricingLine:
    "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation.",
  pricingLineBookingSuffix: "I can book that for you right now if you'd like.",
  /** qualified.md, Nikhil's decline line. */
  declineLine:
    "This sounds like it may not be the right fit for us right now — but feel free to reach out if your timeline or scope changes.",
  callbackWithinHour: "A designer will call you back within the hour.",
  callbackLater: (when: string) => `A designer will call you back ${when}.`,
  escalate: "I'm very sorry about this. I'm passing it to our senior team right now, and someone will call you back.",
  existingClientCallback: "I've noted your message, and the team will call you back.",
  closeNonEnquiry: "Thank you for calling Aangan Studio.",
  dateMovePrompt:
    "A project like this usually needs a few weeks of design and then several weeks of execution, so that date would be very tight for us. If your date could move, we'd be glad to help. Could it?",
  sayReason: {
    service_area: "We only take on projects in Pune city and PCMC at the moment.",
    real_project:
      "We take on projects where we design the space and also carry out the work, so this one is outside what we do.",
    timeline: "We couldn't do the project justice by that date.",
    budget: "I want to be upfront: a full redesign with execution usually needs a larger budget than that.",
  },
} as const;
