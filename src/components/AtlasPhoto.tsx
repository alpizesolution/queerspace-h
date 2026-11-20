import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { fetchMemoryPhoto } from '../services/atlasService.ts';

/** A memory's picture, fetched through the permission-checked request (there is no public link) and shown once it is ready. */
export const AtlasPhoto: React.FC<{ memoryId: string; alt: string; version?: number }> = ({ memoryId, alt, version = 0 }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let live = true;
    setState('loading');
    void fetchMemoryPhoto(memoryId).then((found) => {
      if (!live) return;
      setUrl(found);
      setState(found ? 'ready' : 'error');
    });
    return () => { live = false; };
  }, [memoryId, version]);
  if (state === 'error') {
    return (
      <p data-testid="atlas-photo-error" className="flex min-h-12 items-center gap-2 rounded-xl border border-line bg-ink/60 px-3 text-[length:calc(13px_*_var(--fs,1))] text-muted">
        <ImageOff className="h-4 w-4" aria-hidden="true" /> Picture unavailable
      </p>
    );
  }
  if (state === 'loading' || !url) return <div aria-hidden="true" className="h-44 w-full animate-pulse rounded-xl bg-raised" />;
  return <img src={url} alt={alt} loading="lazy" decoding="async" className="max-h-44 w-full rounded-xl sm:max-h-72 border border-line object-cover" />;
};
