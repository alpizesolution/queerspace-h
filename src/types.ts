export type ChatMode = 'quick' | 'custom' | 'public' | 'community';

export type Intention = 'friendship' | 'dating' | 'casual' | 'deep_talk' | 'open';

export type GenderExpressionOption =
  | 'Femme'
  | 'Soft Masc'
  | 'Hard Masc'
  | 'Andro'
  | 'Hyperfemme'
  | 'Butch'
  | 'Stem'
  | 'No label / Other'
  | 'Prefer not to say';

export interface UserPreferences {
  displayName: string;
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
  showSogieOnProfile?: boolean;
  showLocationOnProfile?: boolean;
  // Matching discovery preferences (optional)
  applyGenderExpressionFilter?: boolean;
  preferredGenderExpressions?: string[];
  locationSelection?: string[];
  applyLocationFilter?: boolean;
}

export type PartnerStatus = 'online' | 'typing' | 'idle' | 'away';

export interface PartnerProfile {
  id: string;
  displayName: string;
  pronouns: string;
  intention: Intention;
  topics: string[];
  region: string;
  location?: string;
  bioSnippet?: string;
  avatarColor: string;
  status?: PartnerStatus;
  // SOGIE & gender expression (optional)
  sexualOrientation?: string;
  genderIdentity?: string;
  genderExpression?: GenderExpressionOption[];
  showGenderExpressionOnProfile?: boolean;
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
}

export interface CommunityReply {
  id: string;
  author: string;
  authorPronouns: string;
  content: string;
  timestamp: number;
}

export interface CommunityPost {
  id: string;
  author: string;
  authorPronouns: string;
  category: 'vents' | 'media' | 'friends' | 'advice' | 'general';
  title: string;
  content: string;
  timestamp: number;
  likes: number;
  userLiked?: boolean;
  replies: CommunityReply[];
  tags: string[];
}

export interface PublicRoomMessage {
  id: string;
  author: string;
  authorPronouns: string;
  avatarColor: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
}
