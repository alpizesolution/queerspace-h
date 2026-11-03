import React, { useId, useState } from 'react';
import { EyeOff, UserPlus } from 'lucide-react';
import { keepCardInView, MoreButton, useClampOverflow } from './ExpandableText.tsx';
import { previewTags, postDisplayTitle, preferredAgeText, type LookingForPost } from '../utils/lookingFor.ts';

interface Props {
  post: LookingForPost;
  mine: boolean;
  /** Mature posts the member opened can be covered again; shown only for those. */
  canCoverAgain: boolean;
  onCoverAgain: () => void;
  onRequest: () => void;
}

/**
 * The open content of a connection card: a short preview with the Send Connection Request action always in reach, and "View details"
 * for the rest. It is only ever rendered for a post that is already open, so a concealed mature post has no details
 * control and nothing here can reveal it. Which cards are expanded is this component's own state, one card at a time.
 */
export const LookingForBody: React.FC<Props> = ({ post, mine, canCoverAgain, onCoverAgain, onRequest }) => {
  const [expanded, setExpanded] = useState(false);
  const introId = useId();
  const seekId = useId();
  const intro = useClampOverflow<HTMLParagraphElement>(expanded, post.intro);
  const seek = useClampOverflow<HTMLParagraphElement>(expanded, post.lookingFor);
  const { shown, hidden } = previewTags(post.tags, expanded);
  const preferred = preferredAgeText(post);
  const hasMore = intro.overflows || seek.overflows || hidden > 0;

  const toggle = () => {
    const wasExpanded = expanded;
    setExpanded(!wasExpanded);
    if (wasExpanded) keepCardInView(intro.ref.current);
  };

  return (
    <>
      <h3 className="mt-3 text-[length:calc(16px_*_var(--fs,1))] font-semibold text-fg leading-snug [overflow-wrap:anywhere] line-clamp-2">{postDisplayTitle(post)}</h3>
      <p id={introId} ref={intro.ref} className={`mt-1 text-[length:calc(14px_*_var(--fs,1))] text-muted leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-3'}`}>{post.intro}</p>

      <div className="mt-2.5 rounded-xl bg-ink/50 border border-line px-3 py-2">
        <p className="text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.12em] text-lavender">Looking for{preferred ? ` · ${preferred}` : ''}</p>
        <p id={seekId} ref={seek.ref} className={`mt-0.5 text-[length:calc(14px_*_var(--fs,1))] text-fg leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-2'}`}>{post.lookingFor}</p>
      </div>

      {shown.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {shown.map((tag) => <span key={tag} className={`tag ${expanded ? 'anim-fade' : ''}`}>#{tag}</span>)}
          {hidden > 0 && <span className="tag text-subtle" aria-label={`${hidden} more interests`}>+{hidden}</span>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {hasMore || expanded ? (
          <MoreButton expanded={expanded} controls={`${introId} ${seekId}`} onClick={toggle} more="View details" />
        ) : <span />}
        <div className="ml-auto flex items-center gap-2">
          {canCoverAgain && <button type="button" onClick={onCoverAgain} className="btn btn-ghost btn-sm"><EyeOff className="w-4 h-4" /> Hide again</button>}
          {!mine && (post.requestsPaused
            ? <button type="button" disabled className="btn btn-secondary btn-sm" title="This member is not taking new requests right now">Requests paused</button>
            : <button type="button" onClick={onRequest} className="btn btn-primary btn-sm"><UserPlus className="w-4 h-4" /> Send Connection Request</button>)}
        </div>
      </div>
    </>
  );
};
