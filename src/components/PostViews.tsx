import React, { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { formatViewCount, hasViewedPost, recordPostView, ViewedCollection } from '../services/postViewsService.ts';

const VISIBLE_MS = 1500;

interface PostViewsProps {
  collection: ViewedCollection;
  postId: string;
  count: number;
  /** Your own post: shown, but never counted. */
  own?: boolean;
  className?: string;
}

/** A view count. The first time a member keeps the post on screen for a moment, it counts once. */
export const PostViews: React.FC<PostViewsProps> = ({ collection, postId, count, own = false, className = '' }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [countedAt, setCountedAt] = useState<number | null>(null);
  const latest = useRef(count);
  latest.current = count;

  useEffect(() => {
    const el = ref.current;
    if (own || !el || hasViewedPost(collection, postId) || typeof IntersectionObserver === 'undefined') return;
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(timer);
        if (!entry?.isIntersecting) return;
        timer = window.setTimeout(() => {
          observer.disconnect();
          void recordPostView(collection, postId).then((ok) => ok && setCountedAt(latest.current));
        }, VISIBLE_MS);
      },
      { threshold: 0.6 }
    );
    observer.observe(el);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [collection, postId, own]);

  // The live feed brings the new total back; until then show our own +1.
  const shown = countedAt === null ? count : Math.max(count, countedAt + 1);
  return (
    <span ref={ref} className={`inline-flex items-center gap-1 whitespace-nowrap text-subtle ${className}`} aria-label={`${shown} views`} title={`${shown} views`}>
      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
      {formatViewCount(shown)}
    </span>
  );
};
