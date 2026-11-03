import React, { useId, useState } from 'react';
import { EyeOff, UserPlus } from 'lucide-react';
import { keepCardInView, MoreButton, useClampOverflow } from './ExpandableText.tsx';
import { INTENTION_LABELS, previewTags, preferredAgeText, type LookingForPost } from '../utils/lookingFor.ts';

/** The line above a post's title: age, flair and intention. Posts from before flairs simply have fewer pieces. */
export const PostMeta: React.FC<{ age?: number; flair?: string; intention: LookingForPost['intention'] }> = ({ age, flair, intention }) => (
  <p className="flex flex-wrap items-center gap-1.5 text-[length:calc(12px_*_var(--fs,1))]">
    {age !== undefined && <span className="font-semibold text-fg">{age}</span>}
    {flair && <span className="inline-flex h-6 items-center rounded-full border border-lavender/25 bg-plum/30 px-2 font-semibold text-lavender">{flair}</span>}
    <span className={`inline-flex h-6 items-center rounded-full border px-2 font-semibold ${intention === 'nsfw' ? 'border-danger/30 bg-danger/15 text-danger' : 'border-line bg-raised text-muted'}`}>{INTENTION_LABELS[intention]}</span>
  </p>
);

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
      <div className="mt-3"><PostMeta age={post.age} flair={post.flair} intention={post.intention} /></div>
      <h3 className="mt-2 text-[length:calc(16px_*_var(--fs,1))] font-semibold text-fg leading-snug [overflow-wrap:anywhere] line-clamp-2">{post.title}</h3>

      <section className="mt-3" aria-label="About me">
        <h4 className="text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.12em] text-lavender">About me</h4>
        <p id={introId} ref={intro.ref} className={`mt-1 text-[length:calc(14px_*_var(--fs,1))] text-muted leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-3'}`}>{post.intro}</p>
      </section>

      <section className="mt-4 rounded-xl bg-ink/50 border border-line px-3 py-2.5" aria-label="About you">
        <h4 className="text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.12em] text-lavender">About you{preferred ? ` · ${preferred}` : ''}</h4>
        <p id={seekId} ref={seek.ref} className={`mt-1 text-[length:calc(14px_*_var(--fs,1))] text-fg leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-3'}`}>{post.lookingFor}</p>
      </section>

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
