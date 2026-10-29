// Public, indexable pages. Every claim here describes something QUEERSPACE PH actually does today.
// Edit the content here, then run `npm run seo` (the build also runs it). Output goes to public/.

export const SITE = 'https://www.queerspaceph.com';
export const SITE_NAME = 'QUEERSPACE PH';
export const OG_IMAGE = `${SITE}/og-image.jpg`;
export const UPDATED = '2026-10-29';

/** The homepage is the app itself (index.html); it is listed here for the sitemap and for link lists. */
export const HOME = {
  path: '/',
  title: 'QUEERSPACE PH – Anonymous WLW Chat & Sapphic Community',
  description:
    'A sapphic space for women who love women in the Philippines. Meet people in anonymous 1-on-1 chat, drop into the Galaxy room, share in Echoes and Cosmos. 18+.',
};

const li = (items) => `<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;

export const PAGES = [
  {
    path: '/anonymous-wlw-chat',
    title: 'Anonymous WLW Chat: How It Works | QUEERSPACE PH',
    description:
      'How anonymous 1-on-1 chat works on QUEERSPACE PH: no account, a pseudonym instead of your name, filters you control, and a private way to stay in touch.',
    h1: 'Anonymous WLW chat on QUEERSPACE PH',
    lead:
      'QUEERSPACE PH is an anonymous chat space for women who love women (WLW) in the Philippines. You can start a one-to-one conversation in a few taps, without creating an account and without sharing your real name.',
    body: `
<h2>How a 1-on-1 chat starts</h2>
<ol>
  <li><strong>Pick a pseudonym and an avatar.</strong> You get a random name and a small animal avatar, and you can change both. There are no photo profiles.</li>
  <li><strong>Tap “Find Your Someone”</strong> for a quick match, or choose “Custom match” to say what you are looking for: friendship, dating, casual chat, a deep talk, or open to anything.</li>
  <li><strong>Add filters only if you want them.</strong> You can pick chat topics, a place in the Philippines (an island group, region or city), and an age range. Your age range is private and is never shown to anyone.</li>
  <li><strong>Get paired</strong> with someone who is online right now, and start talking. You can reply to a message by swiping it, react to it, or skip to someone new.</li>
  <li><strong>The chat ends</strong> when either of you leaves, and nothing is kept afterwards.</li>
</ol>

<h2>What stays anonymous</h2>
${li([
  'You do not need an account. An anonymous ID is created for you automatically in your browser.',
  'You are known by a pseudonym and an animal avatar, not a name or a photo.',
  'Your birthday is stored privately. Your age is hidden by default and is shown to a chat partner only if you turn on “Show my age”.',
  'Details such as gender identity or orientation are optional and stay hidden unless you choose to show them on your profile.',
])}

<h2>Staying in touch, only if you both want to</h2>
<p>If a conversation clicks, you can send a <strong>Signal</strong>: a gentle, optional note that says you would like to stay in touch. The other person decides privately whether to accept, and nothing else is sent. A Signal can only be sent to someone you are chatting with right now, so it is never a way to contact strangers.</p>

<h2>Safety</h2>
${li([
  'QUEERSPACE PH is for adults, 18 and over. Members confirm their birthday when they join; this is self-reported and is not identity verification.',
  'You can skip, leave, block or report someone at any moment.',
  'Community guidelines ask everyone to be kind, respectful and careful with their own privacy and other people’s.',
])}

<h2>Questions</h2>
<h3>Do I need an account?</h3>
<p>No. Your anonymous ID lives in your browser, so clearing site data starts you fresh.</p>
<h3>Can I use it on my phone?</h3>
<p>Yes. QUEERSPACE PH works in a mobile browser and can be added to your home screen like an app.</p>
<h3>Is it a dating app?</h3>
<p>It is conversation-first. Some people come to make friends, some to find dating connections. Read how it differs in <a href="/wlw-dating-philippines">WLW dating in the Philippines</a>.</p>
`,
    related: ['/sapphic-community-philippines', '/wlw-dating-philippines', '/wlw-sapphic-guide'],
  },
  {
    path: '/sapphic-community-philippines',
    title: 'Sapphic Community in the Philippines | QUEERSPACE PH',
    description:
      'QUEERSPACE PH is a sapphic community for women in the Philippines: a public Galaxy room, anonymous Echoes, the Cosmos community feed, and 1-on-1 chat.',
    h1: 'A sapphic community in the Philippines',
    lead:
      'Beyond one-to-one chat, QUEERSPACE PH is a place to belong: a public room to say hi, a wall for things you cannot say out loud, and a community feed for stories, recommendations and advice. It is made for sapphic women and other women who love women, with the Philippines in mind.',
    body: `
<h2>Four ways to take part</h2>
<h3>Galaxy: the public room</h3>
<p>Galaxy is a shared room where everyone can see what you write. Drop in, say hi, talk about what you are reading or listening to, and react to messages with cat-face reactions. You appear under your pseudonym.</p>
<h3>Echoes: say it anonymously</h3>
<p>Echoes is for the things that are hard to say out loud. Choose <em>Vent</em> or <em>Confession</em>, write it, and let it out. No name or avatar is shown, and posts stay visible until you delete them or moderation removes them. Links, @handles and phone numbers are blocked to keep people anonymous. If you are struggling, the app also shows the NCMH Crisis Hotline for the Philippines: <strong>1553</strong>.</p>
<h3>Cosmos: stories, recs and advice</h3>
<p>Cosmos is the community feed. Post with a title, a category and up to four tags. Categories include General, Books &amp; Media, Cozy Vents, Friend Finder, and Dating &amp; Advice. Everyone can like and reply.</p>
<h3>1-on-1 chat</h3>
<p>When you want a conversation with one person, <a href="/anonymous-wlw-chat">anonymous WLW chat</a> pairs you with someone who is online right now.</p>

<h2>Made with the Philippines in mind</h2>
<p>When you choose a location filter, you pick from Philippine island groups (Luzon, Visayas, Mindanao), regions and cities, so you can look for people near you or leave it open to anyone in the country. Location is optional and you control whether it appears on your profile.</p>

<h2>Who it is for</h2>
<p>Women who love women: lesbian, bisexual, pansexual and queer women, and others who feel at home in a sapphic space. If the words are new to you, start with our <a href="/wlw-sapphic-guide">guide to WLW and sapphic</a>. You must be 18 or over.</p>

<h2>Keeping the space kind</h2>
${li([
  'Be kind and respectful, and protect your own privacy and other people’s.',
  'Report posts or people who break the guidelines. In Echoes, posts that receive several reports are hidden for everyone.',
  'Block or leave a conversation whenever you need to.',
])}
`,
    related: ['/anonymous-wlw-chat', '/wlw-dating-philippines', '/wlw-sapphic-guide'],
  },
  {
    path: '/wlw-dating-philippines',
    title: 'WLW Dating in the Philippines: Conversation First | QUEERSPACE PH',
    description:
      'QUEERSPACE PH is not a swipe-based dating app. Meet WLW in the Philippines through live conversation first, with privacy controls and no photo profiles.',
    h1: 'WLW dating in the Philippines: a conversation-first way to connect',
    lead:
      'If you are looking for a WLW dating app in the Philippines, it helps to know what QUEERSPACE PH is and is not. It is not a swipe-based dating app. It is a conversation-first space where people meet by talking, and where some people find friendship and some find romance.',
    body: `
<h2>How it is different from a typical dating app</h2>
${li([
  '<strong>No swiping and no photo profiles.</strong> You are matched with someone who is online right now and you start with a conversation, not a gallery.',
  '<strong>Anonymous by default.</strong> You use a pseudonym and an animal avatar. Your age is hidden unless you choose to show it.',
  '<strong>You say what you are looking for.</strong> Choose friendship, dating, casual chat, a deep talk, or open to anything, so you are matched with people who want the same.',
  '<strong>Optional profile details.</strong> A short About Me, a “My Vibe” label and a Personal Style label help people get a feel for you. Sexual orientation, gender identity and gender expression are optional and hidden unless you show them.',
])}

<h2>From a chat to keeping in touch</h2>
<p>If you enjoy talking to someone, you can send a <strong>Signal</strong>. It is a private, optional note saying you would like to stay in touch. The other person chooses whether to accept. Signals are only possible between people who are already chatting, never to strangers, so nobody gets unwanted requests from people they have not spoken to.</p>

<h2>Meeting people safely</h2>
${li([
  'Take your time. There is no pressure to share personal details, and you can end a chat at any moment.',
  'Keep your real name, handles and contact details private until you feel comfortable.',
  'Trust your instincts. If something feels wrong, skip, block or report.',
  'If you decide to meet someone in person, choose a public place and tell a friend where you are going.',
])}

<h2>What to expect</h2>
<p>QUEERSPACE PH cannot promise a match or a relationship. What it offers is a calm, private place to meet other women who love women and see where a conversation goes. It is for adults, 18 and over, and members confirm their birthday when they join (this is self-reported, not identity verification).</p>
<p>Learn more about <a href="/anonymous-wlw-chat">how anonymous WLW chat works</a> or the wider <a href="/sapphic-community-philippines">sapphic community in the Philippines</a>.</p>
`,
    related: ['/anonymous-wlw-chat', '/sapphic-community-philippines', '/wlw-sapphic-guide'],
  },
  {
    path: '/wlw-sapphic-guide',
    title: 'WLW and Sapphic Explained: A Simple Guide | QUEERSPACE PH',
    description:
      'What WLW and sapphic mean, how the words relate to lesbian, bisexual and queer women, and tips for connecting safely online. A short, friendly guide.',
    h1: 'WLW and sapphic: what the words mean',
    lead:
      'You may see “WLW” and “sapphic” used across queer communities online. This short guide explains what they mean, why people use them, and how to connect with others in a way that feels safe.',
    body: `
<h2>WLW</h2>
<p><strong>WLW</strong> stands for “women who love women”. It describes women who are romantically or emotionally attracted to women. People use it for many experiences, including being a lesbian, bisexual, pansexual or queer, or simply not wanting to pick a more specific label.</p>

<h2>Sapphic</h2>
<p><strong>Sapphic</strong> is a broad word for attraction between women. It comes from Sappho, an ancient Greek poet from the island of Lesbos whose poems were about love between women. Many people use “sapphic” as a welcoming umbrella, and some nonbinary people who are attracted to women use it too.</p>

<h2>Lesbian, bisexual and queer</h2>
<p><strong>Lesbian</strong> usually describes a woman who is attracted to women. <strong>Bisexual</strong> describes attraction to more than one gender. <strong>Queer</strong> is an umbrella that many people use for their sexuality or gender. Words mean slightly different things to different people, and you do not have to choose one. How you describe yourself is up to you, and it can change.</p>

<h2>Finding community</h2>
<p>For many people, finding others who share their experience is the most helpful part. Online spaces can make that easier, especially if you are not out, live far from other queer people, or just want to talk to someone who understands.</p>
<p>QUEERSPACE PH is one such place for women in the Philippines. You can try <a href="/anonymous-wlw-chat">anonymous WLW chat</a>, browse the <a href="/sapphic-community-philippines">sapphic community</a>, or read how <a href="/wlw-dating-philippines">WLW dating works here</a>. It is for adults, 18 and over.</p>

<h2>Staying safe online</h2>
${li([
  'Use a pseudonym and avoid sharing your full name, address, workplace or school.',
  'Be cautious about sharing photos, links or contact details, especially early on.',
  'You are never obliged to answer. Leave, block or report whenever you want.',
  'Take care of yourself. If things feel heavy, talk to someone you trust.',
])}
<p>If you are in the Philippines and need to talk to someone right now, the NCMH Crisis Hotline is free and open 24/7: <strong>1553</strong> or <strong>0917 899 8727</strong>.</p>
`,
    related: ['/anonymous-wlw-chat', '/sapphic-community-philippines', '/wlw-dating-philippines'],
  },
];

/** Short names used in link lists (descriptive anchor text). */
export const ANCHORS = {
  '/': 'QUEERSPACE PH home',
  '/anonymous-wlw-chat': 'Anonymous WLW chat',
  '/sapphic-community-philippines': 'Sapphic community in the Philippines',
  '/wlw-dating-philippines': 'WLW dating in the Philippines',
  '/wlw-sapphic-guide': 'WLW and sapphic guide',
};
