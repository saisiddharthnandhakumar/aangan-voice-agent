import type { ScenarioContent, ScenarioContentMap } from "./content-types";

/**
 * Demo calls 1 to 15 (booked Green). Everything here is invented. The discovery part of each call is written by
 * hand; the shared booking flow (calendar check, slots, email and number read-back, confirmation, close) is built
 * by `build` so every call follows the live script. Timestamps are spread over the call's length.
 */

type Turn = ["A" | "U", string];
type Mid = string[]; // alternates caller, agent, caller ... starting and ending with the caller

const OPENING =
  "Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded so our designers have your details. How can I help you today?";
const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const digitsSpoken = (p: string) => p.split("").map((d) => DIGITS[Number(d)]).join(", ");
const saidByCaller = (e: string) => e.replace(/\./g, " dot ").replace("@", " at ").replace(/_/g, " underscore ");
const spell = (e: string) =>
  e
    .split("@")
    .map((part, i) =>
      i === 1
        ? part.replace(/\./g, " dot ")
        : part.split("").map((c) => (c === "." ? "dot" : c === "_" ? "underscore" : /\d/.test(c) ? DIGITS[Number(c)] : c)).join(", "),
    )
    .join(", at, ");
const grouped = (p: string) => `${p.slice(0, 5)} ${p.slice(5)}`;
const clock = (secs: number) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return `[${[h, m, s].map((n) => String(n).padStart(2, "0")).join(":")}]`;
};

interface Cfg {
  minutes: number;
  mid: Mid;
  email: string;
  phone: string;
  slot: string;
  alt: string;
  src: string;
  recap: string;
  hi?: boolean;
  /** Replaces the plain "yes" to the offer to book. */
  yes?: string;
}

function build(c: Cfg): string {
  const turns: Turn[] = [["A", OPENING]];
  c.mid.forEach((t, i) => turns.push([i % 2 === 0 ? "U" : "A", t]));
  const k = Number(c.phone.slice(5));
  const v = k % 3;
  const offers = [
    "Thank you, that is very helpful. Shall I book a design call with one of our designers? It takes about twenty minutes, by video or phone.",
    "Good, I have what I need. The next step is a design call with a designer, about twenty minutes, by video or phone. Would you like me to book it?",
    "Thank you. Would you like to set up a short design call? A designer will speak with you for about twenty minutes, on video or by phone.",
  ];
  const checks = c.hi ? "Bilkul. Let me check that for you." : ["Of course. Let me check that for you.", "Sure. Let me check that for you.", "Certainly. Let me check that for you."][v];
  const emailIn = [`It's ${saidByCaller(c.email)}.`, `Um, one second... ${saidByCaller(c.email)}.`, `${saidByCaller(c.email)}. Should I spell it?`][v];
  const emailBack = [
    `Let me read that back. ${spell(c.email)}. Is that right?`,
    `Thank you. I have ${spell(c.email)}. Did I get that right?`,
    `No need, I will read it back. ${spell(c.email)}. Is that correct?`,
  ][v];
  const phoneAsk = ["And what is the best number to reach you on?", "Which number should the designer call you on?", "Could you give me the best number to reach you?"][v];
  const bookedLine = c.hi ? "Thank you. Aapka design call book ho gaya hai." : ["Thank you. Your design call is booked.", "All done. Your design call is booked.", "That is booked for you."][v];
  const recapLine = [
    `That is ${c.slot}, about twenty minutes, by video or phone. You will get a confirmation by email. To recap, I have noted ${c.recap}.`,
    `You are set for ${c.slot}. A confirmation will come to your email. I have noted ${c.recap}, so the designer will have it before the call.`,
    `Your call is ${c.slot}, around twenty minutes, on video or phone. Just so you know what I wrote down: ${c.recap}. A confirmation is on its way by email.`,
  ][v];
  turns.push(
    ["A", offers[v]],
    ["U", c.yes ?? ["Yes, please. That would be good.", "Yes, go ahead.", "Okay, yes, let's do that."][v]],
    ["A", checks],
    ["A", `I have ${c.slot}, or ${c.alt}. Which would you prefer?`],
    ["U", c.hi ? "Pehla wala theek rahega." : ["The first one works for me.", "Hmm, the first one, I think.", "First one is fine."][v]],
    ["A", `Good, ${c.slot}. What email address should I send the invitation to?`],
    ["U", emailIn],
    ["A", emailBack],
    ["U", c.hi ? "Haan, bilkul sahi hai." : ["Yes, that's correct.", "Yes, right.", "Correct, thank you."][v]],
    ["A", phoneAsk],
    ["U", `${grouped(c.phone)}.`],
    ["A", `That is ${digitsSpoken(c.phone)}. Is that correct?`],
    ["U", ["Yes.", "Yes, that's right.", "Correct."][v]],
    ["A", "One last thing. How did you hear about the studio?"],
    ["U", c.src],
    ["A", bookedLine],
    ["A", recapLine],
    ["U", c.hi ? "Perfect, thank you so much." : ["Perfect. Thank you for your help.", "Great, thanks a lot.", "Okay, wonderful. Thank you."][v]],
    ["A", ["Thank you for calling Aangan Studio, and have a good day.", "Thank you for calling Aangan Studio. Take care.", "Thank you for calling Aangan Studio, and goodbye."][v]],
  );
  const weights = turns.map(([, t]) => 2 + t.length * 0.07);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.floor(c.minutes * 60) - 8;
  let acc = 0;
  let last = 0;
  return turns
    .map(([who, text], i) => {
      let at = 2 + Math.round((acc / total) * span);
      if (at <= last) at = last + 1;
      last = at;
      acc += weights[i];
      return `${clock(at)} ${who === "A" ? "AGENT" : "USER"}: ${text}`;
    })
    .join("\n\n");
}

const ok = (evidence: string) => ({ status: "pass" as const, evidence });
const mk = (
  c: Cfg,
  rest: {
    summary: string;
    handoffNote: string;
    openQuestions: string[];
    ev: { real: string; area: string; time: string; who: string };
  },
): ScenarioContent => ({
  transcript: build(c),
  summary: rest.summary,
  handoffNote: rest.handoffNote,
  openQuestions: rest.openQuestions,
  tierReason: "all five criteria pass",
  criteria: {
    real_project: ok(rest.ev.real),
    service_area: ok(rest.ev.area),
    timeline: ok(rest.ev.time),
    budget: { status: "pass", evidence: null },
    decision_maker: ok(rest.ev.who),
  },
});

export const contentA: ScenarioContentMap = {
  1: mk(
    {
      minutes: 6.2,
      email: "tara.velankar22@example.com",
      phone: "9999900001",
      slot: "the day after tomorrow at eleven thirty in the morning",
      alt: "the day after tomorrow at four in the afternoon",
      src: "A friend of ours, she got her flat done with you last year.",
      recap: "a three BHK flat in Baner, around fourteen fifty square feet, design and execution, with a move-in by the end of February",
      mid: [
        "Hello, yes, hi. I'm looking for an interior designer for our new flat.",
        "I would be happy to help. May I have your name, please?",
        "Tara Velankar.",
        "Thank you, Tara. Is this for a home or an office?",
        "A home. A three BHK apartment.",
        "Lovely. Which area of Pune is it in?",
        "It's in Baner, near the Pashan link road.",
        "Thank you. Roughly how big is the flat, in square feet?",
        "Um, the carpet area is around fourteen fifty, I think. Let me check the brochure... yes, fourteen fifty.",
        "Good. Would you like our studio to design the space and also carry out the work?",
        "Yes, both. We don't want to run after contractors separately.",
        "Understood. When would you like the project to be complete?",
        "We get possession in January. So we would like to move in by the end of February. We want to start work in November, if the builder allows.",
        "That is clear. Have you already thought about the look you like?",
        "Somewhat. My husband and I have been collecting pictures on Pinterest for months, we both like warm wood and simple lines.",
        "That sounds like a good start. Your designer will love to see those pictures.",
        "Okay, can I send them before the call?",
        "Yes, the designer will tell you where to send them. Let me see what times are free.",
        "Sure, thank you.",
      ].slice(0, 17),
    },
    {
      summary: "Tara Velankar, 3BHK in Baner (about 1450 sq ft). Wants design and execution, move-in by end of February after January possession. Design call booked.",
      handoffNote: "She and her husband have a Pinterest board of warm wood, simple-line looks; ask her to share it before the call. Possession is in January and she hopes to start in November, so confirm the builder's rules on early access and fit-out.",
      openQuestions: ["Will the builder allow work to start in November?", "Which rooms matter most to her husband and her?"],
      ev: { real: "Wants both design and the work done, no separate contractors", area: "Baner, near the Pashan link road", time: "Move in by the end of February", who: "My husband and I have been collecting pictures" },
    },
  ),
  2: mk(
    {
      minutes: 5.4,
      email: "rohan.pendse@example.com",
      phone: "9999900002",
      slot: "tomorrow at four thirty in the evening",
      alt: "tomorrow at twelve noon",
      src: "I saw your work on Instagram.",
      recap: "a two BHK flat in Wakad, about nine hundred and eighty square feet, design and execution, moving in within three months",
      mid: [
        "Hi, I want to do the interiors of my flat. Do you do complete work?",
        "Yes, we can. May I have your name, please?",
        "Rohan. Rohan Pendse.",
        "Thank you, Rohan. What kind of space is it?",
        "Two BHK apartment. About nine eighty square feet.",
        "Good. Which area of Pune is it in?",
        "Wakad. Near Bhumkar Chowk.",
        "Thank you. Would you like our studio to design it and also carry out the work?",
        "Yes, full thing. Design and execution both. Is it a long process, though?",
        "Your designer will explain the steps. The first step is a short design call. May I ask when you would like to move in?",
        "Within three months, if possible. I'm paying rent and EMI both, so I'd like to shift soon.",
        "I understand. That is helpful to know.",
        "Okay.",
        "Is the flat in your name, or is it with someone else?",
        "No, it is mine. I bought it last year. My wife will join the call also, she has her own ideas.",
        "That is lovely. We will be glad to meet you both.",
        "Great.",
      ],
    },
    {
      summary: "Rohan Pendse, 2BHK in Wakad (about 980 sq ft). Wants full design and execution and to move in within three months. Design call booked for tomorrow evening.",
      handoffNote: "Paying rent and EMI together, so speed matters to him; explain the stages and likely duration clearly. His wife will join the call with her own ideas, so expect two voices.",
      openQuestions: ["Is the flat vacant and ready for work now?", "What are his wife's must-haves?"],
      ev: { real: "Design and execution both, full thing", area: "Wakad, near Bhumkar Chowk", time: "Moving in within three months", who: "It is mine, my wife will join the call" },
    },
  ),
  3: mk(
    {
      minutes: 7.1,
      email: "nisha.gadgil@example.com",
      phone: "9999900003",
      slot: "three days from now at five thirty in the evening",
      alt: "three days from now at eleven in the morning",
      src: "I found you on Google.",
      recap: "a two BHK flat in Hinjewadi, about a thousand and twenty square feet, design and execution, moving in by February",
      mid: [
        "Hello? Oh, sorry, is it too late to call?",
        "Not at all, you can call us at any time. The designers will see your details in the morning. May I have your name?",
        "Nisha Gadgil.",
        "Thank you, Nisha. What is the project?",
        "It's my flat. Two BHK. The handover is next month.",
        "Congratulations. Which area is it in?",
        "Hinjewadi, Phase two.",
        "Thank you. And how large is it, roughly?",
        "Ah, around a thousand and twenty square feet. Carpet.",
        "Good. Would you like our studio to design it and also carry out the work?",
        "Uh, I think so. What do you mean by carry out?",
        "We design the interiors and our team builds them, so you deal with one studio from start to finish.",
        "Oh, that is what I want. Yes, please.",
        "Wonderful. When would you like to move in?",
        "Hmm, by February, I think. My lease on the rented place ends then.",
        "That is clear, thank you.",
        "My parents are also coming to see it this weekend, they stay in Satara, but it will be my decision finally.",
        "Understood. I will note that.",
        "Okay.",
      ].slice(0, 17),
    },
    {
      summary: "Nisha Gadgil, 2BHK in Hinjewadi Phase 2 (about 1020 sq ft). Handover next month; wants design and execution, move-in by February. Called after hours.",
      handoffNote: "First-time owner, unsure what execution by the studio covers; walk her through it simply. Her parents will visit the flat this weekend, so a site visit may suit after that.",
      openQuestions: ["Exact handover date?", "Will her parents join the design call?"],
      ev: { real: "That is what I want. Yes, please", area: "Hinjewadi, Phase two", time: "By February, lease ends then", who: "It will be my decision finally" },
    },
  ),
  4: mk(
    {
      minutes: 8.3,
      email: "kabir.athalye@example.com",
      phone: "9999900004",
      slot: "the day after tomorrow at eleven in the morning",
      alt: "the day after tomorrow at three in the afternoon",
      src: "Mere ek dost ne bataya, unka ghar aapne kiya tha.",
      recap: "an independent villa in Kothrud, about twenty-six hundred square feet, a renovation done before a family function in January",
      hi: true,
      yes: "Haan, bilkul, please book kar dijiye.",
      mid: [
        "Hello, namaste. Mujhe apne bungalow ka renovation karwana hai. Aap log karte ho?",
        "Namaste. Ji haan, hum karte hain. Aapka naam bata sakte hain?",
        "Kabir Athalye.",
        "Dhanyavaad, Kabir ji. Bungalow Pune mein kahan hai?",
        "Kothrud mein. Karve Road ke paas.",
        "Theek hai. Lagbhag kitne square feet ka hai?",
        "Plot bada hai, but built-up around twenty six hundred square feet. Do floors.",
        "Samajh gaya. Kya aap chahte hain ki studio design bhi kare aur kaam bhi?",
        "Haan, dono. Humein ek hi jagah se poora kaam chahiye.",
        "Accha. Kaam kab tak poora hona chahiye?",
        "Ghar mein January mein ek family function hai, shaadi ka. Tab tak ready chahiye. November mein shuru karna hai.",
        "Theek hai, yeh clear hai. Kya aap abhi us ghar mein rehte hain?",
        "Haan, par hum upar ka floor khali kar denge. Mere parents neeche rahenge.",
        "Samajh gaya, dhanyavaad.",
        "Woh log bhi design call mein judenge. Dono ki pasand important hai, final main hi dekhta hoon.",
        "Bahut accha. Hum sabka swagat karenge.",
        "Okay.",
      ],
    },
    {
      summary: "Kabir Athalye, independent villa in Kothrud (about 2600 sq ft). Renovation with design and execution, ready before a family function in January. Design call booked.",
      handoffNote: "Renovation with parents living on the ground floor, so phasing and noise matter. His parents will join the call; he makes the final decision. Hinglish speaker.",
      openQuestions: ["Exact date of the January function?", "Any structural changes planned?", "Which floor goes first?"],
      ev: { real: "Humein ek hi jagah se poora kaam chahiye", area: "Kothrud, near Karve Road", time: "Ready before the January function", who: "Final main hi dekhta hoon" },
    },
  ),
  5: mk(
    {
      minutes: 4.9,
      email: "mrinal.sathe@example.com",
      phone: "9999900005",
      slot: "tomorrow at three thirty in the afternoon",
      alt: "tomorrow at ten thirty in the morning",
      src: "Google search.",
      recap: "a three BHK flat in Aundh, about thirteen eighty square feet, design and execution, starting within six weeks and finishing by the end of March",
      mid: [
        "Hello. I need interior design for my flat. Can you help?",
        "Yes, I would be glad to. May I have your name?",
        "Mrinal Sathe.",
        "Thank you, Mrinal. Is this a home or an office?",
        "Home. Three BHK.",
        "Which area of Pune is it in?",
        "Aundh. Near the ITI road.",
        "Thank you. How large is it, in square feet?",
        "Thirteen eighty, carpet.",
        "Would you like our studio to design the space and also carry out the work?",
        "Yes. Do you also do modular kitchens?",
        "Your designer can tell you exactly what is included at the design call. When would you like the project to be complete?",
        "I want to begin within six weeks, and finish by the end of March.",
        "That is clear. Thank you.",
        "Is it okay if my brother joins the call? He is an engineer, he will ask many questions.",
        "Of course. Everyone is welcome.",
        "Good.",
      ],
    },
    {
      summary: "Mrinal Sathe, 3BHK in Aundh (about 1380 sq ft). Wants design and execution, start in about six weeks, done by end of March. Design call booked for tomorrow afternoon.",
      handoffNote: "She asked whether modular kitchens are included; answer this early. Her brother, an engineer, may join the call and ask technical questions.",
      openQuestions: ["Is the flat vacant now?", "Which rooms are the priority?"],
      ev: { real: "Yes, design and carry out the work", area: "Aundh, near the ITI road", time: "Begin in six weeks, finish by end of March", who: "My brother will join the call" },
    },
  ),
  6: mk(
    {
      minutes: 5.8,
      email: "isha.bhoite@example.com",
      phone: "9999900006",
      slot: "four days from now at ten thirty in the morning",
      alt: "four days from now at two thirty in the afternoon",
      src: "The builder suggested you.",
      recap: "a two BHK flat in Hinjewadi, about a thousand and fifty square feet, design and execution, moving in around March",
      mid: [
        "Hello... um, hi. I was told to call you about interiors.",
        "Hello, thank you. I can help with that. May I have your name?",
        "Isha. Isha Bhoite.",
        "Thank you, Isha. What kind of space is it?",
        "It's a flat. Two BHK. Um, we haven't taken it yet, possession in two months.",
        "Congratulations. Which area is it in?",
        "Hinjewadi. Phase one, I think. Sorry, I'll check, yes, Phase one.",
        "No problem. How large is it, roughly?",
        "About one thousand fifty square feet.",
        "Thank you. Would you like our studio to design the space and also carry out the work?",
        "Yes. The builder said you do both. That is what we want.",
        "Good. When would you like to move in?",
        "Maybe March? After the possession, we need some time. Is that okay?",
        "That sounds fine. Thank you for telling me.",
        "My husband will also come. He is traveling this week, so he can join only on video.",
        "That is fine, the design call can be by video.",
        "Oh good, thank you.",
      ],
    },
    {
      summary: "Isha Bhoite, 2BHK in Hinjewadi Phase 1 (about 1050 sq ft). Builder referral; possession in two months, wants design and execution, move-in around March. Design call booked.",
      handoffNote: "Soft-spoken and a little unsure of the process; keep the call simple and reassuring. Her husband is travelling and will join by video.",
      openQuestions: ["Exact possession date?", "Does the builder restrict who can do interiors?"],
      ev: { real: "The builder said you do both. That is what we want", area: "Hinjewadi, Phase one", time: "Move in maybe March", who: "My husband will also come on video" },
    },
  ),
  7: mk(
    {
      minutes: 6.6,
      email: "vikram.joglekar@example.com",
      phone: "9999900007",
      slot: "five days from now at twelve noon",
      alt: "five days from now at five in the evening",
      src: "LinkedIn. A founder I know shared your page.",
      recap: "a small office in Kharadi, about seventeen hundred square feet, design and execution, ready around the end of January",
      mid: [
        "Good afternoon. I'm setting up a new office and need a design and build partner.",
        "Good afternoon. I would be glad to help. May I have your name?",
        "Vikram Joglekar.",
        "Thank you, Vikram. What kind of office is it?",
        "A software services team. About twenty people. Open desks, two cabins, a small meeting room.",
        "That is clear. How large is the space, roughly?",
        "Seventeen hundred square feet.",
        "Thank you. Which area of Pune is it in?",
        "Kharadi. EON side.",
        "Would you like our studio to design the space and also carry out the work?",
        "Yes, turnkey. Before we go ahead, what will it cost?",
        "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.",
        "Fair enough. Let me first tell you the timeline. Our lease starts in six weeks, and we want to be operational by the end of January.",
        "Thank you, that is helpful. When the lease starts, can the team enter the space for the work?",
        "Yes, the landlord has agreed to a fit-out period.",
        "Good to know.",
        "My co-founder and I have both agreed on going with a studio, so we can decide quickly.",
        "That is helpful. We will be glad to meet you both.",
        "Okay.",
      ].slice(0, 17),
    },
    {
      summary: "Vikram Joglekar, small office fit-out in Kharadi (about 1700 sq ft, 20 people). Wants design and execution; lease starts in six weeks, operational by end of January. Design call booked.",
      handoffNote: "Asked early what it will cost and was told the designer will cover it at the consultation; expect him to raise it again. Bring a layout for open desks, two cabins and a meeting room. His co-founder may join.",
      openQuestions: ["Lease start date and fit-out access?", "Does he need furniture, or only the interiors?"],
      ev: { real: "Yes, turnkey. Open desks, two cabins, a meeting room", area: "Kharadi, EON side", time: "Operational by the end of January", who: "My co-founder and I have both agreed" },
    },
  ),
  8: mk(
    {
      minutes: 7.7,
      email: "devika.ranade@example.com",
      phone: "9999900008",
      slot: "six days from now at four in the evening",
      alt: "six days from now at eleven in the morning",
      src: "Meri saheli ke ghar ka kaam aapne kiya hai.",
      recap: "a four BHK flat in Viman Nagar, about twenty-one fifty square feet, design and execution, ready by April",
      hi: true,
      yes: "Haan, zaroor. Book kar do.",
      mid: [
        "Hello, sorry for calling so late. Kya main interior ke baare mein baat kar sakti hoon?",
        "Namaste. Bilkul, aap kabhi bhi call kar sakti hain. Aapka naam kya hai?",
        "Devika Ranade.",
        "Dhanyavaad, Devika ji. Yeh ghar hai ya office?",
        "Ghar hai. Four BHK apartment.",
        "Bahut accha. Pune mein kis area mein?",
        "Viman Nagar. Symbiosis ke paas.",
        "Samajh gaya. Lagbhag kitne square feet ka hai?",
        "Twenty one fifty square feet, roughly.",
        "Kya aap chahti hain ki studio design aur execution dono kare?",
        "Haan, dono. Mujhe kaam ke liye alag alag logon se baat nahi karni.",
        "Theek hai. Kaam kab tak poora chahiye?",
        "Early next year. April tak ho jaye toh best hai. Hum abhi us flat mein nahi rehte, woh khali hai.",
        "Accha, yeh helpful hai. Dhanyavaad.",
        "Mere husband aur main dono final karenge. Woh aaj raat travel kar rahe hain, but call pe aa jayenge.",
        "Bahut accha. Hum dono ka swagat karenge.",
        "Thank you.",
      ],
    },
    {
      summary: "Devika Ranade, 4BHK in Viman Nagar (about 2150 sq ft), vacant. Wants design and execution, ready by April. Called late evening; design call booked in six days.",
      handoffNote: "Hinglish speaker, referred by a friend who is a past client. The flat is empty, so work can begin as soon as the plan is agreed. Her husband will join by phone or video.",
      openQuestions: ["Possession status and any society rules?", "Any structural changes in mind?"],
      ev: { real: "Haan, dono. Mujhe alag alag logon se baat nahi karni", area: "Viman Nagar, near Symbiosis", time: "April tak ho jaye toh best hai", who: "Husband aur main dono final karenge" },
    },
  ),
  9: mk(
    {
      minutes: 5.2,
      email: "sameer.kanitkar@example.com",
      phone: "9999900009",
      slot: "four days from now at eleven in the morning",
      alt: "four days from now at five thirty in the evening",
      src: "Instagram, I follow your page.",
      recap: "a three BHK flat in Baner, about fifteen hundred square feet, design and execution, ready within three months",
      mid: [
        "Hi there. Looking to get my flat designed. Heard good things about you.",
        "Thank you. I would be glad to help. May I have your name?",
        "Sameer Kanitkar.",
        "Thank you, Sameer. Is this a home or an office?",
        "Home. Three BHK in Baner, near Balewadi Phata.",
        "Lovely. Roughly how big is it?",
        "Fifteen hundred square feet.",
        "Thank you. Would you like our studio to design it and also carry out the work?",
        "Yes, the whole thing. Do you give 3D views before starting?",
        "Your designer will explain how the design is shown. When would you like the project to be complete?",
        "Within three months. We have a house-warming in January.",
        "That is clear, thank you.",
        "Okay.",
        "I only need to know, is the flat already with you, and ready for work?",
        "Yes, I bought it two years ago. I'm the owner. My wife and I will decide together.",
        "Understood. That is helpful.",
        "Great.",
      ],
    },
    {
      summary: "Sameer Kanitkar, 3BHK in Baner (about 1500 sq ft). Wants design and execution, complete in three months for a January house-warming. Design call booked.",
      handoffNote: "Asked about 3D views before work starts; be ready to show how designs are presented. He and his wife decide together.",
      openQuestions: ["House-warming date in January?", "Is the flat vacant now?"],
      ev: { real: "Yes, the whole thing", area: "Baner, near Balewadi Phata", time: "Within three months, house-warming in January", who: "I'm the owner. My wife and I decide together" },
    },
  ),
  10: mk(
    {
      minutes: 6.0,
      email: "ananya.phadke@example.com",
      phone: "9999900010",
      slot: "five days from now at three in the afternoon",
      alt: "five days from now at ten in the morning",
      src: "I searched on Google.",
      recap: "a two BHK flat in Aundh, about a thousand and ten square feet, design and execution, moving in by the end of January",
      mid: [
        "Hello. I'm calling to ask about interior design for a flat.",
        "I would be happy to help. May I have your name?",
        "Ananya Phadke.",
        "Thank you, Ananya. What kind of space is it?",
        "Two BHK apartment, about a thousand and ten square feet.",
        "Thank you. Which area of Pune is it in?",
        "Aundh. Near Parihar Chowk.",
        "Would you like our studio to design it and also carry out the work?",
        "Yes, I want everything done by one team.",
        "Good. When would you like to move in?",
        "The possession is next month. I would like to move in by the end of January, because my rent agreement ends then.",
        "That is clear. Thank you.",
        "Okay.",
        "Is anyone else involved in planning the interiors?",
        "No, it is only me. It's my own flat.",
        "Thank you. Let me look at what times are free.",
        "Sure.",
      ],
    },
    {
      summary: "Ananya Phadke, 2BHK in Aundh (about 1010 sq ft). Possession next month, wants design and execution and to move in by end of January. Design call booked.",
      handoffNote: "Rental agreement ends in January, so the move-in date is firm. She is the sole owner and decider.",
      openQuestions: ["Exact possession date?", "Any furniture to keep from the current home?"],
      ev: { real: "Yes, I want everything done by one team", area: "Aundh, near Parihar Chowk", time: "Move in by the end of January", who: "It is only me. It's my own flat" },
    },
  ),
  11: mk(
    {
      minutes: 9.4,
      email: "harsh.bapat@example.com",
      phone: "9999900011",
      slot: "four days from now at twelve thirty in the afternoon",
      alt: "four days from now at four thirty in the evening",
      src: "A friend of mine, Mr. Kulkarni, recommended you.",
      recap: "a three BHK flat in Balewadi, about fifteen sixty square feet, design and execution, ready by the end of February",
      mid: [
        "Good evening. I hope I am not calling too late?",
        "Good evening. Not at all. May I have your name, please?",
        "Harsh Bapat.",
        "Thank you, Mr. Bapat. What is the project?",
        "I have a flat, three BHK, and the handover is in about six weeks. I would like it done properly.",
        "Congratulations. Which area is it in?",
        "Balewadi, close to the High Street.",
        "Thank you. And how large is it?",
        "Fifteen sixty square feet. Carpet area, as per the agreement.",
        "Good. Would you like our studio to design the space and also carry out the work?",
        "Yes, I want the whole work from you. I don't have time to supervise.",
        "Understood. When would you like the project to be complete?",
        "Handover is in six weeks. After that, I would like to shift by the end of February.",
        "That is clear. Thank you.",
        "Should I bring the flat plan for the call? I have the builder's drawing.",
        "Yes, that will help. Your designer will tell you what else to keep ready.",
        "Very good. My wife is also keen, we will both attend.",
        "We will be glad to meet you both.",
        "Thank you.",
      ].slice(0, 17),
    },
    {
      summary: "Harsh Bapat, 3BHK in Balewadi (about 1560 sq ft). Handover in six weeks; wants design and execution, move-in by end of February. Called in the evening; design call booked.",
      handoffNote: "Does not have time to supervise, so he values a single point of contact. He has the builder's drawing and will bring it; his wife will attend too.",
      openQuestions: ["Exact handover date?", "Any society restrictions on work hours?"],
      ev: { real: "I want the whole work from you. I don't have time to supervise", area: "Balewadi, close to the High Street", time: "Shift by the end of February", who: "My wife is keen, we will both attend" },
    },
  ),
  12: mk(
    {
      minutes: 5.5,
      email: "pooja.deodhar@example.com",
      phone: "9999900012",
      slot: "five days from now at ten in the morning",
      alt: "five days from now at one thirty in the afternoon",
      src: "Instagram pe aapka kaam dekha.",
      recap: "a two BHK flat in Pimple Saudagar, about nine sixty square feet, design and execution, ready by the end of December",
      hi: true,
      yes: "Haan, ji, kar dijiye.",
      mid: [
        "Hello, main apne flat ke interiors ke liye call kar rahi hoon.",
        "Namaste. Zaroor. Aapka naam bata dijiye?",
        "Pooja Deodhar.",
        "Dhanyavaad, Pooja ji. Yeh ghar hai ya office?",
        "Ghar. Two BHK flat.",
        "Accha. Pune mein kaunse area mein?",
        "Pimple Saudagar. Kunal Icon Road ke paas.",
        "Theek hai. Flat lagbhag kitne square feet ka hai?",
        "Nine sixty square feet.",
        "Kya aap chahti hain ki studio design aur kaam dono kare?",
        "Haan, dono. Pura kaam ek hi studio se.",
        "Samajh gayi. Kaam kab tak poora hona chahiye?",
        "December ke end tak. Humein Diwali ke baad shift hona hai.",
        "Theek hai, yeh clear hai. Dhanyavaad.",
        "Mere husband se maine baat kar li hai. Hum dono ne decide kiya hai ki aapse milna hai.",
        "Bahut accha. Hum dono ka swagat karenge.",
        "Okay.",
      ],
    },
    {
      summary: "Pooja Deodhar, 2BHK in Pimple Saudagar (about 960 sq ft). Wants design and execution, finished by end of December. Hinglish caller; design call booked.",
      handoffNote: "Pooja and her husband have already agreed to meet the studio. Move-in is after Diwali, so confirm the schedule against a December finish.",
      openQuestions: ["Is the flat vacant now?", "Which rooms come first?"],
      ev: { real: "Haan, dono. Pura kaam ek hi studio se", area: "Pimple Saudagar, near Kunal Icon Road", time: "December ke end tak", who: "Hum dono ne decide kiya hai" },
    },
  ),
  13: mk(
    {
      minutes: 6.8,
      email: "aditya.sabnis@example.com",
      phone: "9999900013",
      slot: "six days from now at five in the evening",
      alt: "six days from now at eleven thirty in the morning",
      src: "I found you on Google.",
      recap: "a three BHK flat in Koregaon Park, about sixteen twenty square feet, design and execution, ready before a family wedding in February",
      mid: [
        "Hello. I would like to enquire about a complete interior makeover for my flat.",
        "Certainly. May I have your name, please?",
        "Aditya Sabnis.",
        "Thank you, Aditya. What kind of space is it?",
        "A three BHK apartment. It is old, about fifteen years, so it needs a full redo.",
        "I see. Which area of Pune is it in?",
        "Koregaon Park. Lane number five.",
        "Roughly how large is it?",
        "Sixteen twenty square feet.",
        "Would you like our studio to design the space and also carry out the work?",
        "Yes. Design and execution both.",
        "Good. When would you like the project to be complete?",
        "My sister's wedding is in the second week of February, and the family will gather at the flat. So it should be done before that.",
        "That is clear. Thank you.",
        "We will not need structural work, just the finishes, the kitchen and the wardrobes.",
        "Understood. Thank you for telling me.",
        "My parents live here too. They said I should decide, so it is up to me.",
        "Thank you. I will note that.",
        "Okay.",
      ].slice(0, 17),
    },
    {
      summary: "Aditya Sabnis, 3BHK in Koregaon Park (about 1620 sq ft). Full redo with design and execution, finished before a family wedding in mid-February. Design call booked.",
      handoffNote: "A 15-year-old flat needing new finishes, kitchen and wardrobes, with no structural work. The family lives there, so discuss phasing. His parents have left the decision to him.",
      openQuestions: ["Can the family move out during work?", "Which items will be kept?"],
      ev: { real: "Yes. Design and execution both", area: "Koregaon Park, lane number five", time: "Before my sister's wedding, second week of February", who: "My parents said I should decide" },
    },
  ),
  14: mk(
    {
      minutes: 4.6,
      email: "lata.gokhale@example.com",
      phone: "9999900014",
      slot: "six days from now at eleven thirty in the morning",
      alt: "six days from now at three in the afternoon",
      src: "The builder's office gave me your number.",
      recap: "a two BHK flat on Sinhagad Road, about nine thirty square feet, design and execution, moving in within three months",
      mid: [
        "Hello? Is this the interior studio?",
        "Yes, you have reached Aangan Studio. May I have your name, please?",
        "Lata Gokhale.",
        "Thank you, Mrs. Gokhale. What is the project?",
        "A flat. Two bedrooms. I am shifting from my old house.",
        "I see. Which area of Pune is the flat in?",
        "Sinhagad Road. Near Vitthalwadi.",
        "Thank you. How large is it, roughly?",
        "Nine thirty square feet, the builder said.",
        "Would you like our studio to design the space and also carry out the work?",
        "Please say that again, I could not hear.",
        "Would you like us to design the flat and also do the work?",
        "Yes, yes. All the work. I cannot manage many people.",
        "I understand. When would you like to move in?",
        "In about three months. My son is also helping me, he is in Mumbai, but I will decide.",
        "That is clear. Thank you.",
        "Okay.",
      ],
    },
    {
      summary: "Lata Gokhale, 2BHK on Sinhagad Road (about 930 sq ft). Wants design and execution, moving in within three months. Design call booked for the day six days out.",
      handoffNote: "An older caller who prefers simple, unhurried talk; consider a phone call over video. She wants one team to manage everything. Her son, in Mumbai, is helping but she decides.",
      openQuestions: ["Phone or video for the design call?", "Exact flat handover status?"],
      ev: { real: "Yes, yes. All the work. I cannot manage many people", area: "Sinhagad Road, near Vitthalwadi", time: "In about three months", who: "My son is helping, but I will decide" },
    },
  ),
  15: mk(
    {
      minutes: 7.4,
      email: "omkar.tilak@example.com",
      phone: "9999900015",
      slot: "three days from now at two in the afternoon",
      alt: "three days from now at ten thirty in the morning",
      src: "A friend, he lives in the same society.",
      recap: "a three BHK flat in Wakad, about fourteen ten square feet, design and execution, starting soon and ready by March",
      mid: [
        "Hi, I want to start the interiors of my flat soon. Can you take it up?",
        "Yes, we can help. May I have your name, please?",
        "Omkar Tilak.",
        "Thank you, Omkar. Is it a home or an office?",
        "A home. Three BHK.",
        "Which area of Pune is it in?",
        "Wakad. Near Hinjewadi flyover.",
        "Thank you. How large is it, roughly?",
        "About fourteen ten square feet.",
        "Would you like our studio to design the space and also carry out the work?",
        "Yes. And I want a nice finish on the living room wall, like a stone look. Is that possible?",
        "That kind of finish would typically cost a bit more, so it is worth discussing early. Your designer can talk it through at the design call. When would you like the project to be complete?",
        "I want to start soon. Finish by March, I think.",
        "That is clear. Thank you.",
        "Okay, no problem.",
        "Will you be deciding on this yourself?",
        "Yes, me and my wife. She is fine with whatever I choose.",
        "Understood. I will note that.",
        "Thanks.",
      ].slice(0, 17),
    },
    {
      summary: "Omkar Tilak, 3BHK in Wakad (about 1410 sq ft). Wants design and execution, start soon and finish by March; stone-look living room wall. Design call booked.",
      handoffNote: "He wants a stone-look finish on the living room wall; the agent mentioned that such finishes can cost more, so be ready to discuss options and the scope openly. He and his wife decide.",
      openQuestions: ["Which finish and brands does he have in mind?", "Is the flat vacant to start now?"],
      ev: { real: "Yes. Design and execution, stone look on living room wall", area: "Wakad, near Hinjewadi flyover", time: "Start soon, finish by March", who: "Me and my wife" },
    },
  ),
};
