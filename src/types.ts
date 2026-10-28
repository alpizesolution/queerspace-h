export type ChatMode = 'quick' | 'custom' | 'public' | 'community';

export type Intention = 'friendship' | 'dating' | 'casual' | 'deep_talk' | 'open';

export type GenderExpressionOption = string;

export interface UserPreferences {
  displayName: string;
  /** Animal avatar code, e.g. "cat.1.3" (see utils/avatar.ts). */
  avatar?: string;
  pronouns: string;
  customPronouns?: string;
  intention: Intention;
  topics: string[];
  region: string;
  // SOGIE profile fields (optional)
  sexualOrientation?: string;
  sexualOrientationCustom?: string;
  genderIdentity?: string;
  genderIdentityCustom?: string;
  genderExpression?: GenderExpressionOption[];
  // Privacy & visibility controls
  showGenderExpressionOnProfile?: boolean;
  showSexualOrientationOnProfile?: boolean;
  showGenderIdentityOnProfile?: boolean;
  /** Legacy all-SOGIE visibility switch, retained for old saved profiles. */
  showSogieOnProfile?: boolean;
  showLocationOnProfile?: boolean;
  // Matching discovery preferences (optional)
  applyGenderExpressionFilter?: boolean;
  preferredGenderExpressions?: string[];
  locationSelection?: string[];
  applyLocationFilter?: boolean;
  /** ISO date (YYYY-MM-DD), stored only in private settings. */
  birthDate?: string;
  /** Short optional public introduction, limited to 160 characters. */
  aboutMe?: string;
  /** Self-selected public presentation label. */
  myVibe?: string;
  /** Optional public aesthetic label (e.g. Vintage); not SOGIE. */
  personalStyle?: string;
  /** True only after the member explicitly saves their profile. */
  profileComplete?: boolean;
  /** Self-declared age (18-99). Kept on this device and in the live queue, never on the public profile. */
  age?: number;
  /** Only match people whose age is within ageMin-ageMax (and who fit theirs). */
  applyAgeFilter?: boolean;
  ageMin?: number;
  ageMax?: number;
}

export type PartnerStatus = 'online' | 'typing' | 'idle' | 'away';

export interface PartnerProfile {
  id: string;
  displayName: string;
  age?: number;
  pronouns: string;
  intention: Intention;
  topics: string[];
  region: string;
  location?: string;
  bioSnippet?: string;
  aboutMe?: string;
  myVibe?: string;
  personalStyle?: string;
  avatarColor: string;
  avatar?: string;
  status?: PartnerStatus;
  // SOGIE & gender expression (optional)
  sexualOrientation?: string;
  genderIdentity?: string;
  genderExpression?: GenderExpressionOption[];
  showGenderExpressionOnProfile?: boolean;
  showSexualOrientationOnProfile?: boolean;
  showGenderIdentityOnProfile?: boolean;
  showSogieOnProfile?: boolean;
  showLocationOnProfile?: boolean;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  userReacted?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'partner' | 'system';
  text: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'delivered';
  reactions?: MessageReaction[];
  /** The message this one answers, as a short quote. */
  replyTo?: ReplyQuote;
}

export interface ReplyQuote {
  id: string;
  text: string;
  /** Who wrote the quoted message, from the reader's point of view. */
  sender: 'user' | 'partner';
}

export interface CommunityReply {
  id: string;
  authorId?: string;
  author: string;
  authorAvatar?: string;
  authorPronouns: string;
  content: string;
  timestamp: number;
}

export interface CommunityPost {
  id: string;
  authorId?: string;
  author: string;
  authorPronouns: string;
  authorAvatar?: string;
  category: 'vents' | 'media' | 'friends' | 'advice' | 'general';
  title: string;
  content: string;
  timestamp: number;
  likes: number;
  userLiked?: boolean;
  replyCount?: number;
  replies: CommunityReply[];
  tags: string[];
}

export interface PublicRoomMessage {
  id: string;
  authorId: string;
  author: string;
  authorPronouns: string;
  authorAvatar?: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
  /** Posted by an admin from /admin; shown with the verified team badge. */
  team?: boolean;
  /** The message a team post answers, as a short quote. */
  replyTo?: RoomQuote;
  /** Reaction counts by type id (see ROOM_REACTIONS); missing means none. */
  reactions?: Record<string, number>;
}

export interface RoomQuote {
  id: string;
  author: string;
  text: string;
}
