import { CommunityPost, PublicRoomMessage } from '../types.ts';

export const INITIAL_COMMUNITY_POSTS: CommunityPost[] = [
  {
    id: 'post-1',
    author: 'Velvet Wren',
    authorPronouns: 'she/her',
    category: 'media',
    title: 'Comfort Sapphic Books for Rainy Days ☕📚',
    content: 'Just finished reading "Legends & Lattes" and "The Priory of the Orange Tree". Looking for recommendations that have that warm, sweet, low-angst sapphic romance feeling. What are your holy grail cozy comfort reads?',
    timestamp: Date.now() - 1000 * 60 * 45, // 45m ago
    likes: 24,
    tags: ['Books', 'Cozy', 'Fantasy'],
    replies: [
      {
        id: 'rep-1',
        author: 'Aster Meadow',
        authorPronouns: 'they/she',
        content: 'Check out "Can\'t Spell Treason Without Tea" by Rebecca Thorne! Literally cozy queer fantasy tea shop magic.',
        timestamp: Date.now() - 1000 * 60 * 30,
      },
      {
        id: 'rep-2',
        author: 'Ruby Bloom',
        authorPronouns: 'she/her',
        content: '"Delilah Green Doesn\'t Care" by Ashley Herring Blake is my annual comfort read! So warm and charming.',
        timestamp: Date.now() - 1000 * 60 * 15,
      },
    ],
  },
  {
    id: 'post-2',
    author: 'Clover Song',
    authorPronouns: 'they/them',
    category: 'vents',
    title: 'Coming out to yourself in your late 20s is weirdly beautiful',
    content: 'Spent years wondering why romance felt like an exhausting performance. Admitting to myself that I love women felt like exhaling after holding my breath for ten years. If anyone else here is a "late bloomer", I see you and it gets so much softer.',
    timestamp: Date.now() - 1000 * 60 * 120, // 2h ago
    likes: 58,
    tags: ['Late Bloomer', 'Personal', 'Healing'],
    replies: [
      {
        id: 'rep-3',
        author: 'Maya Lark',
        authorPronouns: 'she/her',
        content: 'Came out at 26! It felt scary at first, but now life has color that was never there before. Proud of you!',
        timestamp: Date.now() - 1000 * 60 * 80,
      },
    ],
  },
  {
    id: 'post-3',
    author: 'Iris Dusk',
    authorPronouns: 'she/they',
    category: 'friends',
    title: 'Looking for fellow sapphic gamer / anime buddies!',
    content: 'Anyone playing Baldur\'s Gate 3, Stardew Valley, or FFXIV? Would love to form a cozy discord circle or just gush over Shadowheart and Karlach. Drop your favorite cozy games!',
    timestamp: Date.now() - 1000 * 60 * 240, // 4h ago
    likes: 31,
    tags: ['Gaming', 'Anime', 'Friendship'],
    replies: [],
  },
  {
    id: 'post-4',
    author: 'Saffron Mist',
    authorPronouns: 'she/her',
    category: 'advice',
    title: 'How do you ask out a woman in person without panicking?',
    content: 'There is a barista at the local bookstore cafe who always compliments my enamel pins and gives me extra oat foam. How do I casually slip her my number without dissolving into a puddle of awkwardness? Need sapphic bravery advice please!',
    timestamp: Date.now() - 1000 * 60 * 360, // 6h ago
    likes: 42,
    tags: ['Dating', 'Advice', 'Wholesome'],
    replies: [
      {
        id: 'rep-4',
        author: 'Faye Willow',
        authorPronouns: 'she/her',
        content: 'Write on a cute napkin: "You make the best coffee in town, and I would love to take you out for a drink when you\'re off the clock! (number)" and hand it to her with a warm smile right before you walk out! Low pressure and irresistible!',
        timestamp: Date.now() - 1000 * 60 * 190,
      },
    ],
  },
];

export const INITIAL_PUBLIC_ROOM_MESSAGES: PublicRoomMessage[] = [
  {
    id: 'room-1',
    author: 'Dahlia Glow',
    authorPronouns: 'she/her',
    avatarColor: '#8D426B',
    text: 'Happy Friday everyone! Hope everyone has a warm drink in hand ☕',
    timestamp: Date.now() - 1000 * 60 * 18,
    isSelf: false,
  },
  {
    id: 'room-2',
    author: 'Rowan Mist',
    authorPronouns: 'they/she',
    avatarColor: '#382038',
    text: 'Watching sapphic short films on YouTube right now, the cinematography is so dreamy',
    timestamp: Date.now() - 1000 * 60 * 12,
    isSelf: false,
  },
  {
    id: 'room-3',
    author: 'Marigold Lark',
    authorPronouns: 'she/her',
    avatarColor: '#5a2548',
    text: 'Welcome newcomers! Feel free to introduce yourselves or just lurk cozily ✨',
    timestamp: Date.now() - 1000 * 60 * 4,
    isSelf: false,
  },
];
