import { PageHeading } from './PageHeading.tsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Crosshair, LoaderCircle, MapPinOff, Plus, RefreshCw } from 'lucide-react';
import { AtlasMap } from './AtlasMap.tsx';
import { AtlasRecent, type RecentStatus } from './AtlasRecent.tsx';
import { MemoryPanel } from './AtlasMemoryPanel.tsx';
import { MemoryComposer } from './AtlasMemoryComposer.tsx';
import { isValidPick, type PickedPlace } from '../utils/atlasPick.ts';
import { ConfirmDialog, Sheet } from './Sheet.tsx';
import { FloatingAddButton } from './FloatingAddButton.tsx';
import { deleteMemory, forgetMemoryPhoto, listMemories, updateMemory } from '../services/atlasService.ts';
import { atlasProblemText, groupByPlace, normalizeBounds, type AtlasFailure, type AtlasMemory, type MapBounds, type PlaceGroup } from '../utils/atlas.ts';
import { tileConfig } from '../utils/atlasConfig.ts';

type Scope = 'community' | 'mine';
type Status = 'loading' | 'ready' | 'error' | 'denied';

/** Same breakpoint as the app's "desk" variant (a real desktop: wide, with a mouse), so the layout here matches the rest of the app. */
const DESK_QUERY = '(min-width: 1024px) and (pointer: fine), (min-width: 1440px)';
function useIsDesk(): boolean {
  const [desk, setDesk] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESK_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DESK_QUERY);
    const onChange = () => setDesk(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return desk;
}

const placeKey = (memory: { lat: number; lng: number }) => `${memory.lat.toFixed(2)},${memory.lng.toFixed(2)}`;
/** Recent Memories is refreshed when opened, but not more often than this. */
const RECENT_STALE_MS = 60_000;

/**
 * ATLAS is map-first: a compact heading, then the map, which takes every pixel the page can give it on phones and desktops alike. Finding
 * memories is done by exploring the map and tapping stars; Recent Memories is an optional, collapsed-by-default shortcut. Who may see
 * what is decided by the server, never here.
 */
export const AtlasPage: React.FC<{ memberName?: string }> = ({ memberName }) => {
  const isDesk = useIsDesk();
  const tiles = useMemo(() => tileConfig(), []);
  const [scope, setScope] = useState<Scope>('community');
  const [memories, setMemories] = useState<AtlasMemory[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [failure, setFailure] = useState<AtlasFailure>('failed');
  const [truncated, setTruncated] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<AtlasMemory | null>(null);
  // Pinning (or editing) a memory. The place is chosen on THIS page's one map, so it lives here, not in the form.
  const [pin, setPin] = useState<{ editing: AtlasMemory | null; place: PickedPlace | null } | null>(null);
  const [deleting, setDeleting] = useState<AtlasMemory | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [photoVersions, setPhotoVersions] = useState<Record<string, number>>({});
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number; at: number } | null>(null);
  const [tilesFailing, setTilesFailing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<MapBounds | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recent, setRecent] = useState<AtlasMemory[]>([]);
  const [recentStatus, setRecentStatus] = useState<RecentStatus>('idle');
  const recentAt = useRef(0);
  const request = useRef(0);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (which: Scope, bounds: MapBounds | null) => {
    if (which === 'community' && !bounds) return;
    const mine = ++request.current;
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    const result = await listMemories(which, which === 'community' && bounds ? normalizeBounds(bounds) : undefined);
    if (mine !== request.current) return; // a newer request replaced this one
    if (!result.ok) {
      setFailure(result.reason);
      setStatus(result.reason === 'not-allowed' || result.reason === 'suspended' ? 'denied' : 'error');
      return;
    }
    setMemories(result.value.memories);
    setTruncated(result.value.truncated);
    setStatus('ready');
  }, []);

  const loadRecent = useCallback(async () => {
    setRecentStatus('loading');
    const result = await listMemories('recent');
    if (!result.ok) { setRecentStatus('error'); return; }
    setRecent(result.value.memories.slice(0, 3));
    recentAt.current = Date.now();
    setRecentStatus('ready');
  }, []);

  const toggleRecent = () => {
    const opening = !recentOpen;
    setRecentOpen(opening);
    if (opening && (recentStatus === 'idle' || recentStatus === 'error' || Date.now() - recentAt.current > RECENT_STALE_MS)) void loadRecent();
  };

  // The member's own memories load once per visit to that tab; community memories follow the map view.
  useEffect(() => {
    setSelectedKey(null);
    setMemories([]);
    setStatus('loading');
    if (scope === 'mine') void load('mine', null);
    else if (view) void load('community', view);
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const onViewChange = useCallback((bounds: MapBounds) => {
    if (viewTimer.current) clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(() => setView(bounds), 450);
  }, []);
  useEffect(() => () => { if (viewTimer.current) clearTimeout(viewTimer.current); }, []);
  useEffect(() => { if (scope === 'community' && view) void load('community', view); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const groups = useMemo(() => groupByPlace(memories), [memories]);
  const selected: PlaceGroup | null = groups.find((g) => g.key === selectedKey) ?? null;
  const pick = (group: PlaceGroup) => setSelectedKey(group.key);

  const startPin = (editing: AtlasMemory | null) => {
    setSelectedKey(null);
    setPin({ editing, place: editing ? { lat: editing.lat, lng: editing.lng } : null });
  };
  /** A tap (or a drag of the marker) on the map. The map's zoom and position are never touched by choosing a spot. */
  const pickSpot = useCallback((lat: number, lng: number) => {
    setPin((current) => (current ? { ...current, place: { lat, lng } } : current));
  }, []);

  // Choosing a Recent memory: show the community map, fly to it, and open its card as soon as the map has loaded that area.
  const focusRecent = (memory: AtlasMemory) => {
    setPendingKey(placeKey(memory));
    if (scope !== 'community') setScope('community');
    setFlyTo({ lat: memory.lat, lng: memory.lng, zoom: 12, at: Date.now() });
  };
  useEffect(() => {
    if (!pendingKey || scope !== 'community') return;
    if (status === 'ready' && groups.some((g) => g.key === pendingKey)) { setSelectedKey(pendingKey); setPendingKey(null); return; }
    const giveUp = setTimeout(() => setPendingKey(null), 10_000);
    return () => clearTimeout(giveUp);
  }, [pendingKey, groups, scope, status]);

  const onSaved =(memory: AtlasMemory, photoChanged: boolean) => {
    setPin(null);
    if (photoChanged) setPhotoVersions((v) => ({ ...v, [memory.id]: (v[memory.id] ?? 0) + 1 }));
    setToast(pin?.editing ? 'Memory updated.' : 'Memory pinned. It’s now a star on the map.');
    // Show it: the My memories list is reloaded from the server, then the new star is opened.
    setPendingFocus(memory);
    if (scope !== 'mine') setScope('mine');
    else void load('mine', null);
  };
  useEffect(() => {
    if (!pendingFocus || scope !== 'mine' || status !== 'ready') return;
    const found = memories.find((m) => m.id === pendingFocus.id);
    if (!found) return;
    setSelectedKey(placeKey(found));
    setFlyTo({ lat: found.lat, lng: found.lng, zoom: 12, at: Date.now() });
    setPendingFocus(null);
  }, [pendingFocus, memories, scope, status]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    const result = await deleteMemory(deleting.id);
    setBusyId(null);
    if (!result.ok) { setToast(atlasProblemText(result.reason)); setDeleting(null); return; }
    forgetMemoryPhoto(deleting.id);
    setMemories((current) => current.filter((m) => m.id !== deleting.id));
    setRecent((current) => current.filter((m) => m.id !== deleting.id));
    setDeleting(null);
    setToast('Memory deleted.');
  };

  const retry = () => { setStatus('loading'); void load(scope, view); };
  const emptyText = scope === 'mine'
    ? 'You haven’t pinned a memory yet. Tap “New memory” to leave your first star.'
    : 'No shared memories in this part of the map yet. Pan or zoom, or pin the first one here.';

  // One compact heading block: the name and the tagline together.
  const header = (
    <div className="mb-2 flex shrink-0 items-start justify-between gap-3">
      <PageHeading title="ATLAS" tagline="Every place has a story. Every story leaves a mark." />
      <button type="button" onClick={() => startPin(null)} disabled={Boolean(pin)} className="btn btn-primary btn-sm hidden shrink-0 sm:inline-flex">
        <Plus className="h-4 w-4" /> New memory
      </button>
    </div>
  );

  // Community / My memories live on the map itself, so nothing sits above it.
  const tabs = (
    <div role="tablist" aria-label="ATLAS sections" className="absolute left-3 top-3 z-[500] inline-flex gap-0.5 rounded-full border border-line bg-surface/90 p-0.5 shadow-lg shadow-black/30 backdrop-blur">
      {([['community', 'Community'], ['mine', 'My memories']] as const).map(([id, label]) => (
        <button key={id} role="tab" aria-selected={scope === id} onClick={() => setScope(id)} className={`h-8 cursor-pointer rounded-full px-3.5 text-[length:calc(13px_*_var(--fs,1))] font-semibold transition-colors ${scope === id ? 'bg-raised text-fg ring-1 ring-lavender/50' : 'text-muted hover:text-fg'}`}>{label}</button>
      ))}
    </div>
  );

  let mapArea: React.ReactNode;
  if (!tiles) {
    mapArea = (
      <div role="alert" data-testid="atlas-map-unavailable" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <MapPinOff className="h-8 w-8 text-lavender" aria-hidden="true" />
        <p className="font-semibold text-fg">The map isn’t available right now</p>
        <p className="max-w-sm text-[length:calc(13px_*_var(--fs,1))] text-muted">ATLAS is still being set up on this site. Please check back soon.</p>
      </div>
    );
  } else if (status === 'denied') {
    mapArea = (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Compass className="h-8 w-8 text-lavender" aria-hidden="true" />
        <p className="font-semibold text-fg">{atlasProblemText(failure)}</p>
      </div>
    );
  } else {
    mapArea = (
      <>
        <AtlasMap groups={groups} selectedKey={selectedKey} tiles={tiles} onSelect={(group) => { if (!pin) pick(group); }} pick={pin ? { place: pin.place, onPick: pickSpot } : null} onViewChange={scope === 'community' ? onViewChange : undefined} onTilesFailing={() => setTilesFailing(true)} flyTo={flyTo} />
        {tabs}
        {pin && (
          <div role="status" data-testid="pin-hint" className="atlas-chip pointer-events-none absolute left-3 top-[3.6rem] z-[500] inline-flex max-w-[calc(100%-4.5rem)] items-center gap-2">
            <Crosshair className="h-3.5 w-3.5 shrink-0 text-lavender" aria-hidden="true" />
            <span>{isValidPick(pin.place) ? 'Spot chosen. Tap elsewhere or drag the star to move it.' : 'Tap the map to choose where it happened.'}</span>
          </div>
        )}
        <div className="pointer-events-none absolute bottom-7 left-3 z-[500] flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
          {status === 'loading' && <div role="status" className="atlas-chip inline-flex items-center gap-2"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Finding stars…</div>}
          {status === 'ready' && memories.length === 0 && <div role="status" className="atlas-chip">{emptyText}</div>}
          {status === 'ready' && truncated && <div role="status" className="atlas-chip">Zoom in to see more memories here.</div>}
          {status === 'error' && (
            <div role="alert" className="atlas-chip pointer-events-auto inline-flex items-center gap-2">
              {atlasProblemText(failure)}
              <button type="button" onClick={retry} className="inline-flex items-center gap-1 font-semibold text-lavender underline underline-offset-2"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry</button>
            </div>
          )}
          {tilesFailing && <div role="alert" className="atlas-chip">Map tiles aren’t loading. Check your connection.</div>}
        </div>
      </>
    );
  }

  const pinPanel = pin && tiles && (
    <MemoryComposer key={pin.editing?.id ?? 'new'} memberName={memberName} editing={pin.editing} place={pin.place} onClose={() => setPin(null)} onSaved={onSaved} />
  );
  const panel = pinPanel || (selected && (
    <MemoryPanel group={selected} onClose={() => setSelectedKey(null)} onEdit={(m) => startPin(m)} onDelete={setDeleting} photoVersions={photoVersions} busyId={busyId} />
  ));

  return (
    // The page is exactly the visible area (below the header; above the tab bar on a phone). The heading and the Recent strip take what
    // they need and the map gets everything else, so collapsing Recent Memories lets the map grow back.
    <div className="mx-auto flex h-[calc(100dvh-var(--header-h)-var(--tabbar-h-steady))] w-full max-w-[96rem] flex-col px-3 pb-3 pt-2 sm:px-6 sm:pt-4 desk:h-[calc(100dvh-var(--header-h)-1rem)] desk:pb-4">
      {header}
      <div className="mb-2 shrink-0"><AtlasRecent memories={recent} status={recentStatus} open={recentOpen} onToggle={toggleRecent} onPick={focusRecent} onRetry={() => void loadRecent()} /></div>
      <div className={`grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 ${isDesk && panel ? 'desk:grid-cols-[minmax(0,1fr)_22.5rem]' : ''}`}>
        <div className="atlas-stage relative h-full min-h-[200px] overflow-hidden rounded-3xl border border-line bg-surface" style={{ isolation: 'isolate' }}>
          {mapArea}
          {/* Phones: the memory opens as a bottom sheet over the map, clear of the tab bar. */}
          {panel && !isDesk && <div className={`absolute inset-x-0 bottom-0 z-[900] flex flex-col animate-[atlas-rise_0.25s_ease-out] ${pinPanel ? 'max-h-[62%]' : 'max-h-[64%]'}`}>{panel}</div>}
        </div>
        {/* Desktop: a side panel while a star is selected, so the map stays visible. */}
        {isDesk && panel && <aside className="min-h-0 overflow-hidden" aria-label={pinPanel ? 'Pin a memory' : 'Memory details'}>{panel}</aside>}
      </div>

      {/* Not while a memory card is open: on a phone the round button would sit over the card's reaction buttons (and Delete). Close the card to add one. */}
      {!pin && !selected && <FloatingAddButton onClick={() => startPin(null)} label="New memory" />}

      {pin && !tiles && (
        <Sheet title="Pin a memory" onClose={() => setPin(null)} size="sm"><p className="text-sm text-muted">The map isn’t available right now, so memories can’t be pinned yet.</p></Sheet>
      )}
      {deleting && (
        <ConfirmDialog title="Delete this memory?" message="This removes the memory and its picture for everyone. It can’t be undone." confirmLabel="Delete" tone="danger" busy={busyId === deleting.id} onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />
      )}
      {toast && <div role="status" className="fixed inset-x-4 z-[1100] mx-auto w-fit max-w-sm rounded-full border border-line bg-raised px-4 py-2 text-center text-[length:calc(13px_*_var(--fs,1))] text-fg shadow-xl shadow-black/40" style={{ bottom: 'calc(var(--tabbar-h) + 5.5rem)' }}>{toast}</div>}
    </div>
  );
};

export default AtlasPage;
