import React from 'react';

/**
 * Placeholders shown while real content loads. Deliberately quiet: one slow pulse, none at all when the member has asked
 * their device for reduced motion, and the same sizes and spacing as what they stand in for so nothing moves when the
 * real content arrives.
 */

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div aria-hidden="true" className={`rounded-md bg-raised/80 animate-pulse motion-reduce:animate-none ${className}`} />
);

/** One connection row, in the size and spacing of a real one: avatar, name, a "since" line and, now and then, an unread badge. */
export const InboxRowSkeleton: React.FC<{ badge?: boolean }> = ({ badge = false }) => (
  <div className="-mx-2 flex min-h-16 w-[calc(100%+1rem)] items-center gap-3 px-2 py-2.5">
    <Skeleton className="h-10 w-10 shrink-0 !rounded-full" />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-[15px] w-32 max-w-[55%]" />
        {badge && <Skeleton className="h-[18px] w-6 !rounded-full" />}
      </div>
      <Skeleton className="mt-1.5 h-3 w-20" />
    </div>
  </div>
);

/** The inbox while it loads for the first time: its two section headings and about six connections. */
export const InboxSkeleton: React.FC<{ rows?: number }> = ({ rows = 6 }) => (
  <div role="status" aria-busy="true" aria-label="Loading your connections">
    <div className="mb-1.5 flex items-center gap-2 px-1"><Skeleton className="h-3 w-20" /><Skeleton className="h-5 w-6 !rounded-full" /></div>
    <div className="px-1 py-2"><Skeleton className="h-4 w-28" /></div>
    <div className="mt-5">
      <div className="mb-1.5 flex items-center gap-2 px-1"><Skeleton className="h-3 w-14" /><Skeleton className="h-5 w-6 !rounded-full" /></div>
      <div className="space-y-0.5">
        {Array.from({ length: rows }, (_, i) => <InboxRowSkeleton key={i} badge={i === 1 || i === 4} />)}
      </div>
    </div>
  </div>
);

/** A public post card on a profile: its category line, a title and two lines of text. */
export const PostCardSkeleton: React.FC = () => (
  <div className="rounded-2xl border border-line bg-raised/40 p-3.5">
    <div className="flex items-center gap-2"><Skeleton className="h-5 w-24 !rounded-full" /><Skeleton className="h-3 w-8" /></div>
    <Skeleton className="mt-3 h-[15px] w-3/4" />
    <Skeleton className="mt-2 h-3.5 w-full" />
    <Skeleton className="mt-1.5 h-3.5 w-2/3" />
    <div className="mt-3 flex gap-3"><Skeleton className="h-3.5 w-8" /><Skeleton className="h-3.5 w-8" /></div>
  </div>
);

/** A member's profile while it loads: avatar, name and age line, details, bio, an About card and their posts. */
export const ProfileSkeleton: React.FC = () => (
  <div role="status" aria-busy="true" aria-label="Loading profile" className="px-4 sm:px-6">
    <Skeleton className="-mt-10 h-20 w-20 !rounded-full ring-4 ring-ink" />
    <Skeleton className="mt-3 h-[24px] w-48 max-w-[70%]" />
    <Skeleton className="mt-2.5 h-3.5 w-40 max-w-[60%]" />
    <div className="mt-4 space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-2/3" />
    </div>
    <div className="mt-6">
      <Skeleton className="mb-2.5 h-3 w-14" />
      <div className="divide-y divide-line/60 rounded-2xl border border-line bg-raised/40">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-3.5 py-3">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ))}
      </div>
    </div>
    <div className="mt-6">
      <Skeleton className="mb-2.5 h-3 w-12" />
      <div className="space-y-2.5"><PostCardSkeleton /><PostCardSkeleton /></div>
    </div>
  </div>
);
