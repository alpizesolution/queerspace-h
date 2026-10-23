import { PartnerProfile, UserPreferences } from '../types.ts';
import { calculateCompatibilityScore, generateSapphicPseudonym } from './matching-logic.ts';
import { isLocationCompatible } from './philippines-locations.ts';

export const MOCK_PARTNERS: PartnerProfile[] = [
  {
    id: 'partner-maya',
    displayName: 'Maya Lark',
    pronouns: 'she/her',
    intention: 'friendship',
    topics: ['WLW Books & Poetry', 'Plants & Coffee', 'Cats & Dogs'],
    region: 'National Capital Region (NCR), Metro Manila',
    location: 'Quezon City, Metro Manila',
    bioSnippet: 'Currently obsessing over sapphic fantasy novels and trying to keep my calathea alive in QC.',
    avatarColor: '#8D426B',
    genderExpression: ['Femme'],
    sexualOrientation: 'Lesbian',
    genderIdentity: 'Cisgender Woman',
    showGenderExpressionOnProfile: true,
    showSogieOnProfile: true,
    showLocationOnProfile: true,
  },
  {
    id: 'partner-clover',
    displayName: 'Clover Breeze',
    pronouns: 'they/she',
    intention: 'casual',
    topics: ['Chappell Roan & Music', 'Anime & Cozy Games', 'Creative Writing'],
    region: 'Region VII (Central Visayas)',
    location: 'Cebu City, Cebu',
    bioSnippet: 'Indie music nerd, Stardew Valley farmer, and matcha latte enthusiast in Cebu.',
    avatarColor: '#382038',
    genderExpression: ['Soft Masc', 'Andro'],
    sexualOrientation: 'Queer',
    genderIdentity: 'Non-binary / Genderfluid',
    showGenderExpressionOnProfile: true,
    showSogieOnProfile: true,
    showLocationOnProfile: true,
  },
  {
    id: 'partner-rowan',
    displayName: 'Rowan Meadow',
    pronouns: 'she/her',
    intention: 'dating',
    topics: ['WLW Books & Poetry', 'Queer History & Art', 'Plants & Coffee'],
    region: 'Region XI (Davao Region)',
    location: 'Davao City, Davao del Sur',
    bioSnippet: 'Art gallery regular, tea drinker, hoping to meet someone genuinely sweet in Davao.',
    avatarColor: '#5a2548',
    genderExpression: ['Hyperfemme'],
    sexualOrientation: 'Sapphic',
    genderIdentity: 'Cisgender Woman',
    showGenderExpressionOnProfile: true,
    showSogieOnProfile: false, // User chose private SOGIE
    showLocationOnProfile: true,
  },
  {
    id: 'partner-aster',
    displayName: 'Aster Glow',
    pronouns: 'she/they',
    intention: 'deep_talk',
    topics: ['Late Bloomer Stories', 'Venting & Comfort', 'Tech & Work Life'],
    region: 'Cordillera Administrative Region (CAR)',
    location: 'Baguio City, Benguet',
    bioSnippet: 'Came out in my mid-twenties. Enjoying cold Baguio weather and real conversations.',
    avatarColor: '#93436d',
    genderExpression: ['Stem'],
    sexualOrientation: 'Bisexual',
    genderIdentity: 'Demigirl',
    showGenderExpressionOnProfile: true,
    showSogieOnProfile: true,
    showLocationOnProfile: true,
  },
  {
    id: 'partner-hazel',
    displayName: 'Hazel Fern',
    pronouns: 'she/her',
    intention: 'open',
    topics: ['Baking & Cooking', 'Cats & Dogs', 'Anime & Cozy Games'],
    region: 'Region VI (Western Visayas)',
    location: 'Iloilo City, Iloilo',
    bioSnippet: 'Sourdough baker, two rescue tabby cats, always up for cozy chats in Iloilo.',
    avatarColor: '#442240',
    genderExpression: ['Butch'],
    sexualOrientation: 'Lesbian',
    genderIdentity: 'Cisgender Woman',
    showGenderExpressionOnProfile: true,
    showSogieOnProfile: true,
    showLocationOnProfile: true,
  },
  {
    id: 'partner-sol',
    displayName: 'Sol Mist',
    pronouns: 'they/them',
    intention: 'casual',
    topics: ['Chappell Roan & Music', 'Astrology & Tarot', 'Creative Writing'],
    region: 'Region IV-A (CALABARZON)',
    location: 'Antipolo City, Rizal',
    bioSnippet: 'Cancer sun, Pisces moon. Let us trade Spotify playlists and book recs in Rizal.',
    avatarColor: '#7a3159',
    genderExpression: ['Hard Masc'],
    sexualOrientation: 'Pansexual',
    genderIdentity: 'Non-binary / Genderfluid',
    showGenderExpressionOnProfile: true,
    showSogieOnProfile: true,
    showLocationOnProfile: true,
  },
];

export function findBestPartner(userPrefs: UserPreferences, excludeIds: string[] = []): PartnerProfile {
  let eligible = MOCK_PARTNERS.filter(p => !excludeIds.includes(p.id));

  // If user explicitly applied a location filter, filter partners accordingly
  if (
    userPrefs.applyLocationFilter &&
    userPrefs.locationSelection &&
    userPrefs.locationSelection.length > 0 &&
    !userPrefs.locationSelection.includes('Anywhere in the Philippines')
  ) {
    const locationFiltered = eligible.filter(p =>
      isLocationCompatible(userPrefs.locationSelection, p.location || p.region)
    );
    // If we have matches, use them; otherwise fallback to eligible so user is not blocked
    if (locationFiltered.length > 0) {
      eligible = locationFiltered;
    }
  }

  // If user explicitly applied a gender expression filter, prioritize matching partners
  if (
    userPrefs.applyGenderExpressionFilter &&
    userPrefs.preferredGenderExpressions &&
    userPrefs.preferredGenderExpressions.length > 0 &&
    !userPrefs.preferredGenderExpressions.includes('Any / No preference')
  ) {
    const preferredSet = new Set(userPrefs.preferredGenderExpressions);
    const filterMatches = eligible.filter(p => {
      const expressions = p.genderExpression || [];
      // Include partners with matching expressions OR "Prefer not to say" (cannot exclude or penalize)
      return (
        expressions.length === 0 ||
        expressions.includes('Prefer not to say') ||
        expressions.some(e => preferredSet.has(e))
      );
    });

    // Use filtered pool if non-empty, otherwise keep all eligible so user is never blocked
    if (filterMatches.length > 0) {
      eligible = filterMatches;
    }
  }

  // Guarantee blocked personas are NEVER rematched even if all default personas are excluded
  if (eligible.length === 0) {
    const pseud = generateSapphicPseudonym();
    return {
      id: `partner-dyn-${Date.now()}`,
      displayName: pseud.name,
      pronouns: pseud.pronouns,
      intention: userPrefs.intention,
      topics: userPrefs.topics.length > 0 ? userPrefs.topics : ['WLW Books & Poetry', 'Plants & Coffee'],
      region: userPrefs.region || 'National Capital Region (NCR), Metro Manila',
      location: 'Metro Manila, Philippines',
      avatarColor: '#6e2d53',
      bioSnippet: 'Fellow sapphic community member ready to chat in the Philippines!',
      genderExpression: ['No label / Other'],
      showGenderExpressionOnProfile: false,
      showSogieOnProfile: false,
      showLocationOnProfile: true,
    };
  }

  // Rank by compatibility score
  const scored = eligible.map(partner => ({
    partner,
    score: calculateCompatibilityScore(userPrefs, partner),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Pick one of top candidates with some slight random spice
  const topSlice = scored.slice(0, Math.min(3, scored.length));
  const chosen = topSlice[Math.floor(Math.random() * topSlice.length)].partner;
  return chosen;
}

export const ICEBREAKER_PROMPTS = [
  "What sapphic book or movie altered your brain chemistry?",
  "Comfort song or artist on heavy rotation right now?",
  "What does your ideal gentle Sunday look like?",
  "Are you a coffee or tea person, and how do you take it?",
  "Favorite small joy or win from this week?",
  "Do you have pets or house plants you love?",
];

export function getPartnerReply(
  partner: PartnerProfile,
  userMessage: string,
  messageHistoryCount: number
): { text: string; reaction?: string } {
  const lower = userMessage.toLowerCase();

  // Icebreaker replies
  if (lower.includes('altered your brain chemistry') || lower.includes('book or movie')) {
    const recs = [
      "Honestly, *Portrait of a Lady on Fire* and *This Is How You Lose the Time War*! Have you read Time War? The poetic letters killed me in the best way.",
      "*Carol* and *Last Night at the Telegraph Club*! Malinda Lo's writing just felt like home when I first discovered it. What about you?",
      "*The Seven Husbands of Evelyn Hugo* and *Bottoms* for two totally different moods haha! What's yours?"
    ];
    return { text: recs[Math.floor(Math.random() * recs.length)], reaction: '❤️' };
  }

  if (lower.includes('comfort song') || lower.includes('rotation') || lower.includes('music')) {
    const tunes = [
      "I've had Chappell Roan's 'Casual' and boygenius' 'Not Strong Enough' on repeat all month! Who are you listening to lately?",
      "Anything by Clairo, Julien Baker, and Remi Wolf! What vibe do you usually lean into?",
      "Fletcher and King Princess for energy, Phoebe Bridgers when I want to stare at the ceiling haha. What's your top comfort track?"
    ];
    return { text: tunes[Math.floor(Math.random() * tunes.length)], reaction: '✨' };
  }

  if (lower.includes('sunday') || lower.includes('routine')) {
    return {
      text: "Waking up without an alarm, brewing an oat milk pour-over, walking somewhere with big trees, and reading for two uninterrupted hours. How about your dream weekend?",
      reaction: '🌸'
    };
  }

  if (lower.includes('coffee') || lower.includes('tea')) {
    return {
      text: "Definitely iced oat latte in the morning, and jasmine green or chamomile tea at night! How do you take yours?",
      reaction: '☕'
    };
  }

  if (lower.includes('pets') || lower.includes('plants')) {
    return {
      text: "I have an unruly monstera deliciosa and a rescue cat who judges every move I make haha! Do you have any furry companions or green babies?",
      reaction: '🫂'
    };
  }

  // Greetings
  if (lower === 'hi' || lower === 'hello' || lower === 'hey' || lower.includes('hey there') || lower.includes('hi!')) {
    const greetings = [
      `Hi there! It's lovely to meet you. How is your day going so far?`,
      `Hey! So nice to match with someone on here. How's your week treating you?`,
      `Hello! I love finding fellow sapphics to talk to. What brings you to QUEERSPACE today?`,
    ];
    return { text: greetings[Math.floor(Math.random() * greetings.length)], reaction: '🌸' };
  }

  // General conversational responses
  if (messageHistoryCount <= 2) {
    const earlyReplies = [
      "I completely agree! It's so refreshing having an anonymous sapphic space where people actually talk without pretense.",
      "Totally! I love that we matched on this. What kind of things do you usually enjoy doing when you have free time?",
      "Aww I love that! What was the highlight of your week so far?"
    ];
    return { text: earlyReplies[Math.floor(Math.random() * earlyReplies.length)], reaction: '✨' };
  }

  const generalReplies = [
    "That makes so much sense! I can totally relate to that feeling.",
    "Oh wow, tell me more! I love hearing people talk about what they're passionate about.",
    "Haha that's amazing! You seem really sweet to chat with.",
    "I was literally thinking the exact same thing earlier! It's rare to stumble across someone who gets that.",
    "That is so valid. I appreciate you sharing that with me! How long have you felt that way?",
  ];

  return { text: generalReplies[Math.floor(Math.random() * generalReplies.length)] };
}
