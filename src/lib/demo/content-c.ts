import type { ScenarioContentMap } from "./content-types";

/**
 * Demo calls 33 to 45: not-rated enquiries, dropped calls, complaints and non-enquiries. All invented.
 * Turns are written as "A: ..." (agent) and "U: ..." (caller); `script` spreads them over the call's length so
 * timestamps always increase and finish inside the duration.
 */
const OPENING =
  "Hello, thank you for calling Aangan Studio. I'm the studio's AI assistant, and this call is recorded so our designers have your details. How can I help you today?";

function script(totalSeconds: number, turns: string[]): string {
  const span = Math.max(totalSeconds - 3, turns.length);
  return turns
    .map((t, i) => {
      const sec = Math.min(totalSeconds - 1, 1 + Math.floor((i * span) / turns.length));
      const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
      const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
      const ss = String(sec % 60).padStart(2, "0");
      const who = t.startsWith("A: ") ? "AGENT" : "USER";
      return `[${hh}:${mm}:${ss}] ${who}: ${t.slice(3)}`;
    })
    .join("\n\n");
}

const A = (s: string) => `A: ${s}`;
const U = (s: string) => `U: ${s}`;

export const contentC: ScenarioContentMap = {
  // 33: Anil Sohoni, Aundh, not rated, 4.4 min
  33: {
    transcript: script(264, [
      A(OPENING),
      U("Hi. I'm looking for an interior designer for our apartment."),
      A("Thank you. May I have your name, please?"),
      U("Anil Sohoni."),
      A("Thank you, Anil. Which area of Pune is the apartment in?"),
      U("Aundh. It's near the ITI road."),
      A("Lovely. Is this a flat you have bought, or one you already live in?"),
      U("We bought it last year. The builder gave us the keys in August, so it's empty right now."),
      A("Understood. How many bedrooms does it have?"),
      U("Three bedrooms, and a study. About fourteen hundred square feet."),
      A("Thank you. What would you like designed? The whole home, or only some rooms?"),
      U("The whole thing. Modular kitchen, wardrobes, living room, the master bedroom, everything."),
      A("That is a full home project. Do you already have the floor plan from the builder?"),
      U("Yes, I have the plan and the carpet area sheet."),
      A("Good. When would you like the work to start?"),
      U("We would like to start before Diwali if possible. My wife is keen to shift by January."),
      A("Thank you. Is the flat ready for work, with the plastering and plumbing done?"),
      U("Yes, the builder has finished all that. Only paint and fittings are left."),
      A("Great. Will you be the one making the decisions on this project?"),
      U("My wife and I decide together. She has already picked a few photographs of rooms she likes."),
      A("That is helpful. Are both of you able to join a conversation with the designer?"),
      U("Yes, we can. Weekends are easiest for us."),
      A("Noted. How did you hear about Aangan Studio?"),
      U("I searched on Google. Your reviews looked good."),
      A("Thank you. Is there anything else you would like the designer to know?"),
      U("Just that we would like warm wood tones, not too many dark colours."),
      A("I have noted that. Let me confirm your number, digit by digit: nine, eight, zero, zero, one, two, three, four, five, six. Is that right?"),
      U("Yes, that is correct."),
      A("Thank you, Anil. Your details are with the studio. A designer will call you back to take this forward."),
      U("Okay, great. Thank you."),
      A("Thank you for calling Aangan Studio. Have a good day."),
    ]),
    summary:
      "Full-home 3BHK, about 1,400 sq ft in Aundh, keys received, wants to start before Diwali. Tier was not recorded: read the transcript, decide, then call back.",
    handoffNote:
      "The agent did not record a tier because its tools never reached the server. Everything else was gathered. Couple decide together and prefer weekends. Likes warm wood tones. Source: Google.",
    openQuestions: [
      "Is the possession-to-start timing real? The flat is vacant and ready for fit-out.",
      "Budget was not discussed on the call: raise it at the design call.",
      "Which weekend slot suits both Anil and his wife?",
    ],
    tierReason: null,
    criteria: null,
  },

  // 34: no name, not rated, 3.8 min
  34: {
    transcript: script(228, [
      A(OPENING),
      U("Hello? Yes, hi. Is this the interior design company?"),
      A("Yes, this is Aangan Studio. May I have your name, please?"),
      U("Uh, I would rather not give it right now. Can I just ask my questions?"),
      A("Of course. I can pass on your details without a name for now. What are you planning?"),
      U("We are doing up a flat. Two bedrooms. Old flat, we bought it second-hand."),
      A("I see. Which area of Pune is it in?"),
      U("Pimpri. Near the old Mumbai highway."),
      A("Thank you. What would you like done in the flat?"),
      U("Everything is old. We want the kitchen redone, new wardrobes, and the bathrooms tiled again."),
      A("That sounds like a big renovation. Is anyone living in the flat now?"),
      U("No, it is empty. The previous owner left last month."),
      A("Good. When would you like the work to begin?"),
      U("As soon as possible. Maybe the next three or four weeks."),
      A("Thank you. Will you be the one making the decisions?"),
      U("Me and my brother. He is paying half, so he also has a say."),
      A("Understood. Do you have any photographs or ideas of what you want?"),
      U("Some from Instagram. I can send them if you give me an email."),
      A("A designer will share the best way to send those. How did you find the studio?"),
      U("Instagram. I saw one of your kitchen reels."),
      A("Thank you. Is there anything else the designer should know?"),
      U("Only that I work in shifts, so mornings are bad. Evenings are better."),
      A("Noted, evenings. May I have the best number to reach you on?"),
      U("Nine eight one one two two three four four five."),
      A("Let me repeat it digit by digit: nine, eight, one, one, two, two, three, four, four, five. Is that right?"),
      U("Yes, correct."),
      A("Thank you. A designer will call you back to take this forward."),
      U("Okay. Thanks."),
      A("Thank you for calling Aangan Studio. Have a good day."),
    ]),
    summary:
      "Caller gave no name. Second-hand 2BHK in Pimpri, kitchen, wardrobes and bathrooms, wants to start in 3 to 4 weeks. Not rated: read it, decide, call back in the evening.",
    handoffNote:
      "No tier was recorded (tools did not reach the server). Caller declined a name; the brother co-funds and has a say. Prefers evening calls. Has Instagram photos to share.",
    openQuestions: [
      "Pimpri is borderline for the service area: confirm it is covered.",
      "Is this a full project or three separate jobs? Scope looks like kitchen, wardrobes and bathrooms only.",
      "Will the brother join the design call?",
    ],
    tierReason: null,
    criteria: null,
  },

  // 35: Seema Bhide, Pimple Saudagar, not rated, 4.1 min
  35: {
    transcript: script(246, [
      A(OPENING),
      U("Hi, haan, I wanted to know about interior design for my flat."),
      A("Happy to help. May I have your name, please?"),
      U("Seema Bhide."),
      A("Thank you, Seema. Which area of Pune is the flat in?"),
      U("Pimple Saudagar. Kunal Icon road ke paas."),
      A("Thank you. Is this a new flat, or one you live in already?"),
      U("Naya hai. Possession mil gaya hai, but abhi we are staying in rent."),
      A("Understood. How many bedrooms?"),
      U("Two BHK. Around nine hundred sixty square feet."),
      A("What would you like the studio to do for you?"),
      U("Complete interiors. Kitchen, wardrobes, TV unit, and the false ceiling in the hall."),
      A("Thank you. When would you like to begin?"),
      U("Actually we are not sure. My husband says wait till after the festival season."),
      A("That is fine. Roughly when might that be?"),
      U("Maybe December, maybe later. Depends on our rent agreement also."),
      A("Understood. Who makes the final decision on the interiors?"),
      U("Both of us, but he decides on money matters. I do the design part."),
      A("Thank you. Would he be able to join a conversation with the designer?"),
      U("Maybe on a weekend. I will have to ask him."),
      A("No problem. How did you hear about us?"),
      U("My neighbour used your studio. She gave me the number."),
      A("That is nice to hear. Is there anything else the designer should know?"),
      U("Just that I want a lot of storage. The flat is small."),
      A("Noted. May I have the best number to reach you on?"),
      U("Nine seven six six zero one two three four five."),
      A("Thank you. Digit by digit: nine, seven, six, six, zero, one, two, three, four, five. Correct?"),
      U("Haan, correct."),
      A("Thank you, Seema. A designer will call you back to take this forward."),
      U("Okay, thank you."),
      A("Thank you for calling Aangan Studio. Have a good day."),
    ]),
    summary:
      "Seema Bhide, 2BHK in Pimple Saudagar, full interiors, start unclear (maybe December or later). Not rated: timeline needs judging. Husband handles money decisions.",
    handoffNote:
      "No tier recorded (tools did not reach the server). Project is real and in area. Timeline is vague and the husband decides on money: a designer should check intent before booking time. Referred by a neighbour who is a client.",
    openQuestions: [
      "Is the start date really December, or is this exploratory?",
      "Can the husband join the first call?",
      "Neighbour referral: which past client, for the record?",
    ],
    tierReason: null,
    criteria: null,
  },

  // 36: no name, dropped, 0.6 min
  36: {
    transcript: script(36, [
      A(OPENING),
      U("Hello? Hello, can you hear me?"),
      A("Yes, I can hear you. How can I help you today?"),
      U("I wanted to ask about... sorry, the network is bad here, can you..."),
      A("I am still here. Could you say that again?"),
      U("Hello?"),
    ]),
    summary: "The line dropped within seconds, before any name or project detail. Nothing to follow up beyond the number, if the caller rings again.",
    handoffNote: null,
    openQuestions: ["What was the caller asking about? Nothing was captured."],
    tierReason: null,
    criteria: null,
  },

  // 37: Hemant Vaidya, Kothrud, dropped, 1.1 min
  37: {
    transcript: script(66, [
      A(OPENING),
      U("Hi, I want some interior work done at my house."),
      A("Happy to help. May I have your name, please?"),
      U("Hemant Vaidya."),
      A("Thank you, Hemant. Which area of Pune is the property in?"),
      U("Kothrud. It's an old bungalow, we want to redo..."),
      A("Thank you. What would you like redone?"),
      U("Hold on, somebody is at the door, one minute..."),
      A("Of course. I will wait."),
      U("Sorry, I'll call back later."),
    ]),
    summary: "Hemant Vaidya, old bungalow in Kothrud, wants it redone. Hung up after the second question. Worth a callback to find out the scope.",
    handoffNote: "Only name, area and a rough idea (redoing a bungalow) were captured. The caller said he would ring back but is worth calling.",
    openQuestions: ["What is the scope: renovation of the whole bungalow or a few rooms?", "Timeline and who decides were never asked."],
    tierReason: null,
    criteria: null,
  },

  // 38: no name, dropped, 0.4 min
  38: {
    transcript: script(24, [
      A(OPENING),
      U("Haan, hello. Aap interior wale ho?"),
      A("Yes, this is Aangan Studio. How can I help you today?"),
      U("Ek minute."),
    ]),
    summary: "Caller asked if this was the interior studio, said hold on, and the line went quiet then dropped. No name or details.",
    handoffNote: null,
    openQuestions: ["Unknown reason for the call."],
    tierReason: null,
    criteria: null,
  },

  // 39: no name, dropped, 0.5 min
  39: {
    transcript: script(30, [
      A(OPENING),
      U("Hi. Do you do kitchens?"),
      A("Yes, the studio designs kitchens as part of a home project. Could I have your name, please?"),
      U("Just checking. I'll call again."),
    ]),
    summary: "Caller asked only whether the studio does kitchens, gave no name, and hung up. Nothing to follow up.",
    handoffNote: null,
    openQuestions: ["Was this a real enquiry or a quick check? Unknown."],
    tierReason: null,
    criteria: null,
  },

  // 40: Mandar Kale, Baner, complaint, 4.2 min
  40: {
    transcript: script(252, [
      A(OPENING),
      U("Hi. I am an existing client of yours and I have a problem with my project."),
      A("I am sorry to hear that. May I have your name, please?"),
      U("Mandar Kale."),
      A("Thank you, Mandar. Which site is this, and who is your designer?"),
      U("It's my flat in Baner. My designer is Prachi."),
      A("Thank you. Please tell me the issue in a line or two."),
      U("The wardrobe shutters in the master bedroom were fitted last week and two of them are misaligned. The gap is visible."),
      A("I understand. Has anyone from the studio seen it yet?"),
      U("Prachi saw the photos I sent. She said she would look into it, but nothing has happened for three days."),
      A("I am sorry about that. Is this the only issue, or is there anything else?"),
      U("The carpenter also left the floor with a lot of dust and some paint marks on the skirting."),
      A("Thank you. I have noted the shutters and the marks on the skirting."),
      U("Can you tell me what will be done about it?"),
      A("I cannot decide that on this call. A senior person at the studio will be in touch about it."),
      U("When will they call?"),
      A("I cannot promise a time, but I will make sure your note reaches them today."),
      U("Okay. I just want someone to actually fix it this time."),
      A("I understand. What is the best number to reach you on?"),
      U("Same number I am calling from. Nine eight nine zero four five six seven eight nine."),
      A("Thank you. Let me repeat it digit by digit: nine, eight, nine, zero, four, five, six, seven, eight, nine. Is that right?"),
      U("Yes, that is right."),
      A("Thank you, Mandar. Your designer is Prachi, the issue is the misaligned shutters and the paint marks, and your number is noted. A senior person will be in touch."),
      U("Okay. Thanks."),
      A("Thank you for calling Aangan Studio. I am sorry for the trouble."),
    ]),
    summary: "Existing client Mandar Kale, flat in Baner, designer Prachi. Misaligned wardrobe shutters and paint marks after fitting. Needs a senior person to call.",
    handoffNote:
      "Escalated, not solved on the call. He sent photos to Prachi three days ago and has heard nothing. No callback time was promised. Please review the photos before calling.",
    openQuestions: ["Have the photos reached Prachi and the site team?", "Can a carpenter revisit and fix both shutters and the skirting?"],
    tierReason: null,
    criteria: null,
  },

  // 41: Rekha Joshi, Wakad, complaint, frustrated, 3.6 min
  41: {
    transcript: script(216, [
      A(OPENING),
      U("Finally someone answers. I have been calling and messaging for five days and nobody replies."),
      A("I am sorry about that. May I have your name, please?"),
      U("Rekha Joshi. I am a client. My flat is in Wakad."),
      A("Thank you, Rekha. Who is your designer?"),
      U("Sneha. She was very good in the beginning. Now she does not pick up."),
      A("I am sorry. What is the issue, in a line or two?"),
      U("The kitchen was due last Friday. The countertop has not come and the plumber is waiting. I have asked five times."),
      A("Thank you. I have noted the kitchen countertop delay."),
      U("Every day somebody says tomorrow. I have a family function at home next week."),
      A("I understand how stressful that is. I am sorry nobody has come back to you."),
      U("Please, just make sure someone senior calls me. I do not want to hear the same answer again."),
      A("I will pass this on as urgent. A senior person will be in touch."),
      U("Today? Can you say today?"),
      A("I cannot promise a time. I will make sure the note goes to them right away."),
      U("Fine. I really hope so."),
      A("What is the best number to reach you on?"),
      U("Nine one two three four five six seven eight nine."),
      A("Let me repeat it digit by digit: nine, one, two, three, four, five, six, seven, eight, nine. Is that right?"),
      U("Yes."),
      A("Thank you, Rekha. Designer Sneha, kitchen countertop delay, and no reply for five days. A senior person will be in touch."),
      U("Okay. Thank you."),
      A("Thank you for calling Aangan Studio. I am sorry again for the wait."),
    ]),
    summary: "Existing client Rekha Joshi, Wakad, designer Sneha. Kitchen countertop delayed, five days without a reply, family function next week. Frustrated: senior call needed.",
    handoffNote:
      "Escalated. She is upset about being ignored more than the delay itself. The plumber is waiting on site. No callback time was promised on the call, but she asked for today.",
    openQuestions: ["Where is the countertop order, and when can it arrive?", "Why were her messages to Sneha unanswered for five days?"],
    tierReason: null,
    criteria: null,
  },

  // 42: Sagar Mehendale, vendor, 1.2 min
  42: {
    transcript: script(72, [
      A(OPENING),
      U("Good morning. I am Sagar from a laminate and plywood supplier. Do you have a minute?"),
      A("Thank you for calling. I am the studio's assistant. May I have your name and company?"),
      U("Sagar Mehendale, from Sahyadri Boards. We supply laminates and plywood in Pune."),
      A("Thank you, Sagar. What would you like the studio to know?"),
      U("We are offering a trade discount for interior studios. I would like to send a catalogue."),
      A("I cannot make purchasing decisions. I will note your message for the team."),
      U("Sure. Can you take my number?"),
      A("Yes. What is it?"),
      U("Nine eight six zero two three four five six seven."),
      A("Digit by digit: nine, eight, six, zero, two, three, four, five, six, seven. Is that right?"),
      U("Yes, that is right."),
      A("Thank you. I have noted it. If the studio is interested, someone will reach out."),
      U("Okay, thank you."),
      A("Thank you for calling Aangan Studio. Have a good day."),
    ]),
    summary: "Supplier pitch from Sagar Mehendale (laminates and plywood), offering a trade discount and a catalogue. No action needed unless the studio wants a supplier.",
    handoffNote: "Number was noted in case the team wishes to see the catalogue.",
    openQuestions: [],
    tierReason: null,
    criteria: null,
  },

  // 43: job seeker, no name, 1.5 min
  43: {
    transcript: script(90, [
      A(OPENING),
      U("Hi, I wanted to ask if you have any openings for interior designers."),
      A("Thank you for asking. May I have your name, please?"),
      U("I would rather not say on the phone. I will email."),
      A("That is fine. I am the studio's assistant, and I cannot discuss hiring."),
      U("Okay. I am a fresher, finished my diploma this year. Is there any place for interns?"),
      A("I do not have that information. I will note that you called about work and internships."),
      U("Can you give me an email to send my portfolio?"),
      A("I do not have a hiring email to share on this call. I will pass your interest to the team."),
      U("Alright. Can someone call me?"),
      A("I cannot promise that. Please look for a careers section on the studio's website."),
      U("Okay, I will check. Thank you."),
      A("Thank you for calling Aangan Studio. Best wishes."),
    ]),
    summary: "A fresher interior designer asked about openings and internships, gave no name. Nothing needed beyond pointing to the careers page.",
    handoffNote: null,
    openQuestions: [],
    tierReason: null,
    criteria: null,
  },

  // 44: wrong number, 0.5 min
  44: {
    transcript: script(30, [
      A(OPENING),
      U("Oh, sorry. Is this Deshmukh Medical?"),
      A("No, this is Aangan Studio, an interior design studio. I think you may have the wrong number."),
      U("Oh. Sorry, wrong number."),
      A("No problem. Have a good day."),
    ]),
    summary: "Wrong number: the caller wanted a medical store. Ended politely, nothing to do.",
    handoffNote: null,
    openQuestions: [],
    tierReason: null,
    criteria: null,
  },

  // 45: Leena Purandare, Aundh, existing client, delivery date, 2.3 min
  45: {
    transcript: script(138, [
      A(OPENING),
      U("Hello. I am already a client. I wanted to check something about my delivery."),
      A("Happy to take a message. May I have your name, please?"),
      U("Leena Purandare."),
      A("Thank you, Leena. Which site is this, and who is your designer?"),
      U("My flat in Aundh. My designer is Rohit."),
      A("Thank you. What would you like to know?"),
      U("The sofa and the dining table were supposed to be delivered on the fifteenth. Is that still the date?"),
      A("I cannot see delivery schedules. I will note that you want to confirm the date for the sofa and dining table."),
      U("Okay. I have a painter coming that week so I need to plan."),
      A("Understood. I will include that. Is this a complaint, or only a date check?"),
      U("Just a check. No complaint, everything has been fine."),
      A("Good to hear. What is the best number to reach you on?"),
      U("Nine eight five zero one two three four five six."),
      A("Digit by digit: nine, eight, five, zero, one, two, three, four, five, six. Is that right?"),
      U("Yes."),
      A("Thank you, Leena. Your message goes to the team and they will get back to you about the delivery date."),
      U("Great, thank you."),
      A("Thank you for calling Aangan Studio. Have a good day."),
    ]),
    summary: "Existing client Leena Purandare, Aundh, designer Rohit, asking to confirm the delivery date of the sofa and dining table (the 15th). Not a complaint: reply with the date.",
    handoffNote: "A painter is booked for the same week, so she needs the date to plan. Rohit or the site team can reply.",
    openQuestions: ["Is the 15th still the delivery date for the sofa and dining table?"],
    tierReason: null,
    criteria: null,
  },
};
