import '../../test/dom-setup.ts';
import test, { mock, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// The first render pulls in the whole page; give the async queries room on a busy machine.
configure({ asyncUtilTimeout: 8000 });

/** The ATLAS page, its memory card and its composer, with the map itself stood in for (Leaflet needs a real browser; the real map is
 *  checked in the browser run). Everything else is the real code, talking to a fake /api/atlas. */
mock.module('../lib/firebase.ts', { namedExports: { auth: { currentUser: { uid: 'alice', getIdToken: async () => 'token' } }, db: null } });
mock.module('../utils/atlasConfig.ts', { namedExports: { tileConfig: () => ({ url: 'https://tiles.test/{z}/{x}/{y}.png', attribution: 'x', maxZoom: 18, tone: 'dark' }) } });
mock.module('./AtlasMap.tsx', {
  namedExports: {
    starIcon: () => ({}),
    AtlasMap: ({ groups, onSelect, onViewChange, pick, flyTo }: { groups: { key: string; memories: { title: string }[] }[]; onSelect: (g: unknown) => void; onViewChange?: (b: unknown) => void; pick?: { place: { lat: number; lng: number } | null; onPick: (lat: number, lng: number) => void } | null; flyTo?: { lat: number; lng: number; zoom?: number } | null }) => {
      React.useEffect(() => { onViewChange?.({ south: 0, west: 100, north: 20, east: 130 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
      // The one real map, stood in for: while a place is being chosen, tapping it reports a point; nothing else about it changes.
      return (
        <div data-testid="fake-map" data-picking={pick ? 'true' : 'false'} data-fly={flyTo ? `${flyTo.lat},${flyTo.lng},${flyTo.zoom}` : ''}>
          {groups.map((g) => <button key={g.key} onClick={() => onSelect(g)}>{`star:${g.memories.map((m) => m.title).join('+')}`}</button>)}
          {pick && <button type="button" onClick={() => pick.onPick(14.5995123, 120.9842199)}>Pick Manila</button>}
          {pick && <button type="button" onClick={() => pick.onPick(34.6937, 135.5023)}>Pick Osaka</button>}
          <span data-testid="picked">{pick?.place ? `${pick.place.lat},${pick.place.lng}` : 'none'}</span>
        </div>
      );
    },
  },
});
const { AtlasPage } = await import('./AtlasPage.tsx');
const { MemoryPanel } = await import('./AtlasMemoryPanel.tsx');

type Mem = Record<string, unknown>;
const memory = (id: string, extra: Mem = {}): Mem => ({ id, mine: false, title: `Title ${id}`, text: `Words ${id}`, date: '2024-06-01', lat: 14.6, lng: 120.98, placeLabel: 'Manila Bay', visibility: 'public', displayIdentity: 'profile', displayName: 'Willow', identity: null, hasPhoto: false, createdAt: 1, author: { id: 'writer123', displayName: 'Willow', avatar: null, pronouns: 'she/her' }, ...extra });

let calls: { url: string; body?: Mem }[] = [];
let community: Mem[] = [];
let recentList: Mem[] = [];
let mine: Mem[] = [];
let respond: (body: Mem) => { status: number; json: Mem } | null = () => null;
let engagement: Record<string, { views: number; hugs: number; hearts: number; mine: string | null }> = {};
let viewed = new Set<string>();
let reactGate: Promise<void> | null = null;
let reactStatus = 200;

beforeEach(() => {
  calls = [];
  community = [memory('c1'), memory('c2', { lat: 35.68, lng: 139.65, title: 'Tokyo night', visibility: 'friends' })];
  recentList = [];
  mine = [memory('m1', { mine: true, author: null, visibility: 'private', title: 'My pier' })];
  respond = () => null;
  engagement = {}; viewed = new Set(); reactGate = null; reactStatus = 200;
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: q.includes('min-width: 1024px'), addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Mem) : undefined;
    calls.push({ url: String(url), body });
    const custom = body ? respond(body) : null;
    if (custom) return { ok: custom.status < 300, status: custom.status, json: async () => custom.json };
    if (body?.action === 'list') return { ok: true, status: 200, json: async () => ({ memories: body.scope === 'mine' ? mine : body.scope === 'recent' ? recentList : community, truncated: false }) };
    if (body?.action === 'create') { const m = memory(String(body.id), { ...body, mine: true, author: null }); mine = [m, ...mine]; return { ok: true, status: 201, json: async () => ({ memory: { ...m, lat: 14.6, lng: 120.98 }, replayed: false }) }; }
    if (body?.action === 'update') { mine = mine.map((m) => (m.id === body.id ? { ...m, ...body } : m)); return { ok: true, status: 200, json: async () => ({ memory: mine.find((m) => m.id === body.id) }) }; }
    if (body?.action === 'view') {
      const e = (engagement[String(body.id)] ??= { views: 0, hugs: 0, hearts: 0, mine: null });
      if (!viewed.has(String(body.id))) { viewed.add(String(body.id)); e.views += 1; }
      return { ok: true, status: 200, json: async () => ({ engagement: { ...e } }) };
    }
    if (body?.action === 'react') {
      if (reactGate) await reactGate;
      if (reactStatus !== 200) return { ok: false, status: reactStatus, json: async () => ({ error: 'nope' }) };
      const e = (engagement[String(body.id)] ??= { views: 0, hugs: 0, hearts: 0, mine: null });
      if (e.mine === 'hug') e.hugs -= 1; if (e.mine === 'heart') e.hearts -= 1;
      e.mine = (body.kind as string | null) ?? null;
      if (e.mine === 'hug') e.hugs += 1; if (e.mine === 'heart') e.hearts += 1;
      return { ok: true, status: 200, json: async () => ({ engagement: { ...e } }) };
    }
    if (body?.action === 'delete') { mine = mine.filter((m) => m.id !== body.id); return { ok: true, status: 200, json: async () => ({ deleted: true }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
});
afterEach(cleanup);

const posts = () => calls.filter((c) => c.body).map((c) => c.body as Mem);

test('the community map asks the server for memories in view, shows each as a star, and opens one into a card with its author', async () => {
  render(<AtlasPage />);
  const star = await screen.findByRole('button', { name: 'star:Title c1' });
  assert.ok(await screen.findByRole('button', { name: 'star:Tokyo night' }));
  const listed = posts().find((b) => b.action === 'list');
  assert.equal(listed?.scope, 'community');
  assert.deepEqual(Object.keys(listed?.bounds as object).sort(), ['east', 'north', 'south', 'west']);
  fireEvent.click(star);
  const card = await screen.findByTestId('memory-panel');
  assert.ok(within(card).getByText('Title c1'));
  assert.ok(within(card).getByText('Words c1'));
  assert.ok(within(card).getByText(/Manila Bay/));
  assert.equal(within(card).queryByText(/approximate/i), null, 'no "Approximate area" / "approximate" wording on the card');
  assert.equal(within(card).queryByText(/^Shared$/), null, 'no "Shared" label');
  assert.ok(within(card).getByText('Willow'));
  assert.equal(within(card).queryByRole('button', { name: 'Edit' }), null, 'no edit or delete on someone else\'s memory');
  assert.equal(within(card).queryByRole('button', { name: 'Delete' }), null);
});

test('an anonymous memory shows its cosmic name and no profile; several memories at one star can be stepped through', async () => {
  community = [memory('a1', { displayIdentity: 'anonymous', displayName: 'Nova', author: null, title: 'Hidden one', createdAt: 5 }), memory('a2', { title: 'Second here', createdAt: 9 })];
  render(<AtlasPage />);
  fireEvent.click(await screen.findByRole('button', { name: /^star:/ }));
  const card = await screen.findByTestId('memory-panel');
  assert.ok(within(card).getByText('1/2'), 'a compact pager');
  assert.ok(within(card).getByText('Second here'), 'newest first');
  assert.ok(within(card).getByText('Willow'), 'a memory that uses the author\'s pseudonym names them');
  fireEvent.click(within(card).getByRole('button', { name: 'Next memory' }));
  assert.ok(within(card).getByText('Hidden one'));
  assert.equal(within(card).getByTestId('memory-author-name').textContent, 'Nova', 'the same name the server sent');
  assert.equal(within(card).queryByText('Willow'), null);
  assert.equal(within(card).queryByRole('button', { name: /profile/i }), null, 'no profile link on an anonymous memory');
});

test('My memories: lists only the member\'s own; the owner can edit and delete (after confirming) but has no control for who can see it', async () => {
  render(<AtlasPage />);
  fireEvent.click(await screen.findByRole('tab', { name: 'My memories' }));
  fireEvent.click(await screen.findByRole('button', { name: 'star:My pier' }));
  const card = await screen.findByTestId('memory-panel');
  assert.ok(within(card).getByRole('button', { name: 'Edit' }));
  assert.equal(within(card).queryByRole('radio'), null, 'no visibility switch on the card');
  assert.equal(within(card).queryByText(/Who can see it/i), null);
  assert.equal(posts().some((b) => 'visibility' in b), false, 'nothing about visibility is ever sent');
  fireEvent.click(within(card).getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => assert.ok(posts().some((b) => b.action === 'delete' && b.id === 'm1')));
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: 'star:My pier' }), null));
});

test('pinning a memory needs a title, a place and a valid date; then it sends the words and the chosen point, with one stable id', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  const submit = await screen.findByRole('button', { name: 'Pin this memory' });
  assert.equal((submit as HTMLButtonElement).disabled, true, 'saving waits for a place on the map');
  assert.ok(screen.getByTestId('pin-needs-location'));
  fireEvent.click(screen.getByRole('button', { name: 'Pick Manila' }));
  assert.equal((screen.getByRole('button', { name: 'Pin this memory' }) as HTMLButtonElement).disabled, false, 'a spot on the map enables saving');
  fireEvent.click(screen.getByRole('button', { name: 'Pin this memory' }));
  assert.ok(await screen.findByText('Give your memory a title.'));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Our first sunrise' } });
  fireEvent.change(screen.getByLabelText('Date of the memory'), { target: { value: '2999-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pin this memory' }));
  assert.ok(await screen.findByText(/not in the future/));
  fireEvent.change(screen.getByLabelText('Date of the memory'), { target: { value: '2024-06-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pin this memory' }));
  await waitFor(() => assert.ok(posts().some((b) => b.action === 'create')));
  const created = posts().find((b) => b.action === 'create') as Mem;
  assert.equal(created.title, 'Our first sunrise');
  assert.equal(created.date, '2024-06-01');
  assert.equal('visibility' in created, false, 'the app never sends a visibility: the server makes every memory public');
  assert.deepEqual(created.displayIdentity, { mode: 'profile' }, 'the default is the member\'s own pseudonym');
  assert.equal(created.lat, 14.5995123, 'the app sends the chosen point; the SERVER rounds it (see the integration tests)');
  assert.ok(/^[A-Za-z0-9_-]{8,128}$/.test(String(created.id)), 'a client id so a retry never makes a second memory');
  assert.equal('ownerId' in created, false);
  await waitFor(() => assert.ok(screen.queryByRole('button', { name: 'Pin this memory' }) === null));
});

test('words that break the community rules are stopped before any memory is sent (every memory is read by members)', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  await screen.findByRole('button', { name: 'Pin this memory' });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'kys' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pick Manila' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pin this memory' }));
  assert.ok(await screen.findByText(/community guidelines/));
  assert.equal(posts().some((b) => b.action === 'create'), false);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A kind title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pin this memory' }));
  await waitFor(() => assert.ok(posts().some((b) => b.action === 'create')));
});

test('loading, empty, error and not-allowed states are shown plainly, and the error offers a retry', async () => {
  respond = (b) => (b.action === 'list' ? { status: 500, json: { error: 'internal_error' } } : null);
  const first = render(<AtlasPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Retry/ }));
  await waitFor(() => assert.ok(posts().filter((b) => b.action === 'list').length >= 2));
  first.unmount();
  respond = (b) => (b.action === 'list' ? { status: 403, json: { error: 'not_allowed' } } : null);
  render(<AtlasPage />);
  assert.ok(await screen.findByText(/Save your profile with your birthday/));
  cleanup();
  respond = () => null;
  community = [];
  render(<AtlasPage />);
  assert.ok(await screen.findByText(/No shared memories in this part of the map yet/));
});

test('the author\'s own card says who can see it and how their name shows, with nothing to change it; an older narrower memory says so', () => {
  const pub = { key: 'k', lat: 14.6, lng: 120.98, memories: [memory('x1', { mine: true, author: null, visibility: 'public', displayIdentity: 'anonymous', displayName: 'Polaris', identity: { mode: 'anonymous' } }) as never] };
  const first = render(<MemoryPanel group={pub as never} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} photoVersions={{}} busyId={null} />);
  assert.equal(screen.queryByTestId('memory-audience'), null, 'a public memory needs no audience label');
  assert.match(screen.getByTestId('memory-identity').textContent ?? '', /Shown as Polaris/, 'the author sees the very name others see');
  assert.equal(screen.getByTestId('memory-identity').getAttribute('title'), 'Your account stays private');
  assert.equal(screen.queryByRole('radio'), null);
  first.unmount();
  const own = { key: 'k', lat: 14.6, lng: 120.98, memories: [memory('x2', { mine: true, author: null, visibility: 'public', identity: { mode: 'profile' } }) as never] };
  const second = render(<MemoryPanel group={own as never} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} photoVersions={{}} busyId={null} />);
  assert.match(screen.getByTestId('memory-identity').textContent ?? '', /Shown as your pseudonym/);
  second.unmount();
  const legacy = { key: 'k', lat: 14.6, lng: 120.98, memories: [memory('x3', { mine: true, author: null, visibility: 'friends', identity: { mode: 'profile' } }) as never] };
  render(<MemoryPanel group={legacy as never} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} photoVersions={{}} busyId={null} />);
  assert.match(screen.getByTestId('memory-audience').textContent ?? '', /connections.*earlier version/i);
});

test('ATLAS is map-first: one compact heading with the tagline, and no search, connections filter or Browse above the map', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  const heading = screen.getByRole('heading', { level: 1 });
  assert.match(heading.textContent ?? '', /ATLAS/);
  assert.match(heading.textContent ?? '', /Every place has a story\. Every story leaves a mark\./, 'title and tagline are one heading block');
  assert.equal(screen.queryByRole('searchbox'), null);
  assert.equal(screen.queryByLabelText(/search/i), null);
  assert.equal(screen.queryByRole('button', { name: /from my connections/i }), null);
  assert.equal(screen.queryByRole('button', { name: /browse/i }), null);
  // The Community / My memories switch sits on the map itself, not above it.
  const stage = document.querySelector('.atlas-stage') as HTMLElement;
  assert.ok(within(stage).getByRole('tablist', { name: 'ATLAS sections' }));
  assert.ok(stage.querySelector('[data-testid="fake-map"]'));
});

test('Recent Memories is collapsed by default and asks for nothing until opened', async () => {
  recentList = [memory('r1')];
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  const toggle = screen.getByTestId('recent-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByTestId('recent-panel'), null, 'nothing but the toggle takes space');
  assert.equal(posts().some((b) => b.scope === 'recent'), false, 'collapsed: no request for it');
});

test('opening Recent Memories shows at most three with a small picture slot, title and approximate place; collapsing it hides them again', async () => {
  recentList = [1, 2, 3, 4, 5].map((n) => memory(`r${n}`, { title: `New ${n}`, placeLabel: n === 3 ? '' : `Place ${n}`, lat: 10 + n }));
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getByTestId('recent-toggle'));
  const panel = await screen.findByTestId('recent-panel');
  const list = await within(panel).findByRole('list', { name: /last 24 hours/ });
  const items = within(list).getAllByRole('button');
  assert.equal(items.length, 3, 'three at most');
  assert.ok(within(list).getByText('New 1') && within(list).getByText('Place 1'));
  assert.ok(within(list).getByText('Approximate area'), 'a memory with no place name says so');
  assert.equal(posts().find((b) => b.scope === 'recent')?.bounds, undefined, 'the preview is not tied to the map view');
  assert.equal(screen.getByTestId('recent-toggle').getAttribute('aria-expanded'), 'true');
  fireEvent.click(screen.getByTestId('recent-toggle'));
  assert.equal(screen.queryByTestId('recent-panel'), null);
  assert.equal(screen.getByTestId('recent-toggle').getAttribute('aria-expanded'), 'false');
});

test('choosing a Recent memory opens it on the community map; the three-memory limit never hides the rest of the map', async () => {
  community = [memory('c1', { title: 'Older one' }), memory('r1', { title: 'Fresh star', lat: 35.68, lng: 139.65 })];
  recentList = [memory('r1', { title: 'Fresh star', lat: 35.68, lng: 139.65 })];
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Older one' });
  fireEvent.click(screen.getByTestId('recent-toggle'));
  const panel = await screen.findByTestId('recent-panel');
  fireEvent.click(await within(panel).findByRole('button', { name: /Fresh star/ }));
  const card = await screen.findByTestId('memory-panel');
  assert.ok(within(card).getByText('Fresh star'));
  assert.ok(screen.getByRole('button', { name: 'star:Older one' }), 'the older memory is still on the map');
  assert.equal(screen.getAllByRole('button', { name: /^star:/ }).length, 2, 'every memory is still a star');
});

test('with nothing new in 24 hours, Recent Memories says so and the map is unchanged', async () => {
  recentList = [];
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getByTestId('recent-toggle'));
  assert.ok(await screen.findByText(/No new memories in the last 24 hours/));
  assert.ok(screen.getByRole('button', { name: 'star:Title c1' }));
});

test('the form has no visibility choice at all: no Only me, Connections or Everyone, and it says every memory is visible to all members', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  const panel = await screen.findByTestId('pin-panel');
  assert.equal(within(panel).queryByText(/Who can see it/i), null);
  for (const gone of [/Only me/, /Connections/, /Everyone/]) assert.equal(within(panel).queryByRole('radio', { name: gone }), null, String(gone));
  assert.match(within(panel).getByTestId('atlas-public-note').textContent ?? '', /^Your account stays private either way\.$/);
  assert.doesNotMatch(within(panel).getByTestId('atlas-public-note').textContent ?? '', /visible|members/i, 'one subtle line, nothing more');
});

test('the Post as choice is always there with two options: My pseudonym (the default, showing the member\'s name underneath) or Anonymous (nothing underneath); it changes what will be shown and what is sent', async () => {
  render(<AtlasPage memberName="Violet Lark" />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  await screen.findByRole('button', { name: 'Pin this memory' });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Moon walk' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pick Manila' }));
  const identity = screen.getByTestId('atlas-identity');
  const options = within(identity).getAllByRole('radio');
  assert.deepEqual(options.map((o) => within(o).getByText(/^(My pseudonym|Anonymous)$/).textContent), ['My pseudonym', 'Anonymous'], 'exactly these two, nothing to type');
  assert.equal(within(identity).queryByRole('textbox'), null, 'no name can be typed');
  assert.equal(within(identity).getByRole('radio', { name: /My pseudonym/ }).getAttribute('aria-checked'), 'true', 'the default');
  assert.match(screen.getByTestId('atlas-identity-preview').textContent ?? '', /Violet Lark/);
  assert.match(screen.getByTestId('atlas-identity').textContent ?? '', /Shown as Violet Lark/, 'the pseudonym is shown underneath the selector');
  fireEvent.click(within(identity).getByRole('radio', { name: /Anonymous/ }));
  assert.equal(within(identity).getByRole('radio', { name: /Anonymous/ }).getAttribute('aria-checked'), 'true');
  assert.equal(within(identity).getByRole('radio', { name: /My pseudonym/ }).getAttribute('aria-checked'), 'false');
  assert.equal(screen.queryByTestId('atlas-identity-preview'), null, 'nothing is shown underneath for a new anonymous memory (the server picks the cosmic name)');
  assert.doesNotMatch(screen.getByTestId('atlas-identity').textContent ?? '', /Violet Lark/);
  fireEvent.click(screen.getByRole('button', { name: 'Pin this memory' }));
  await waitFor(() => assert.ok(posts().some((b) => b.action === 'create')));
  const created = posts().find((b) => b.action === 'create') as Mem;
  assert.deepEqual(created.displayIdentity, { mode: 'anonymous' });
  assert.equal('ownerId' in created || 'displayName' in created || 'authorId' in created || 'visibility' in created || 'anonymousAlias' in created || 'alias' in created, false, 'only the choice goes up: no name, no cosmic name (the server picks it), no id, no audience');
});

test('the server refusing the author choice is explained plainly and keeps the selection', async () => {
  respond = (b) => (b.action === 'create' ? { status: 400, json: { error: 'invalid_identity' } } : null);
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  await screen.findByRole('button', { name: 'Pin this memory' });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Rooftop' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pick Manila' }));
  fireEvent.click(within(screen.getByTestId('atlas-identity')).getByRole('radio', { name: /Anonymous/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Pin this memory' }));
  assert.ok(await screen.findByText(/Choose how your name should appear/));
  assert.equal(within(screen.getByTestId('atlas-identity')).getByRole('radio', { name: /Anonymous/ }).getAttribute('aria-checked'), 'true');
});

test('editing a memory starts from the author\'s saved choice, can switch it, and never sends a visibility', async () => {
  mine = [memory('m1', { mine: true, author: null, visibility: 'public', title: 'My pier', displayIdentity: 'anonymous', displayName: 'Nova', identity: { mode: 'anonymous' } })];
  render(<AtlasPage />);
  fireEvent.click(await screen.findByRole('tab', { name: 'My memories' }));
  fireEvent.click(await screen.findByRole('button', { name: 'star:My pier' }));
  fireEvent.click(within(await screen.findByTestId('memory-panel')).getByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Save changes' });
  assert.equal(within(screen.getByTestId('atlas-identity')).getByRole('radio', { name: /Anonymous/ }).getAttribute('aria-checked'), 'true');
  assert.match(screen.getByTestId('atlas-identity-preview').textContent ?? '', /Shown as Nova/, 'an anonymous memory keeps the cosmic name it has');
  assert.equal(screen.queryByRole('radio', { name: /Only me|Connections|Everyone/ }), null);
  fireEvent.click(within(screen.getByTestId('atlas-identity')).getByRole('radio', { name: /My pseudonym/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.ok(posts().some((b) => b.action === 'update')));
  const updated = posts().find((b) => b.action === 'update') as Mem;
  assert.deepEqual(updated.displayIdentity, { mode: 'profile' });
  assert.equal('visibility' in updated, false, 'an edit cannot change who can see a memory');
});

test('Pin a memory has no map of its own: the one ATLAS map switches into selection mode, and a tap on it chooses the spot', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  const map = screen.getByTestId('fake-map');
  assert.equal(map.getAttribute('data-picking'), 'false');
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  const panel = await screen.findByTestId('pin-panel');
  assert.equal(screen.getAllByTestId('fake-map').length, 1, 'still exactly one map');
  assert.equal(screen.queryByTestId('atlas-picker-map'), null, 'no second map in the form');
  assert.equal(panel.querySelector('.leaflet-container'), null);
  assert.equal(screen.getByTestId('fake-map'), map, 'the same map instance: it was not rebuilt');
  assert.equal(map.getAttribute('data-picking'), 'true', 'selection mode is on');
  assert.match(screen.getByTestId('pin-hint').textContent ?? '', /Tap the map to choose/);
  assert.equal(screen.queryByTestId('pin-location'), null, 'no location instruction box in the form');
  assert.equal(screen.getByTestId('picked').textContent, 'none');
  // Tap a spot, then tap another: the marker moves, nothing is saved.
  fireEvent.click(screen.getByRole('button', { name: 'Pick Manila' }));
  assert.equal(screen.getByTestId('picked').textContent, '14.5995123,120.9842199');
  assert.match(screen.getByTestId('pin-hint').textContent ?? '', /Spot chosen/);
  fireEvent.click(screen.getByRole('button', { name: 'Pick Osaka' }));
  assert.equal(screen.getByTestId('picked').textContent, '34.6937,135.5023');
  assert.equal(posts().filter((b) => b.action === 'create').length, 0, 'choosing a spot saves nothing');
  // The map was not moved by choosing a spot.
  assert.equal(map.getAttribute('data-fly'), '', 'no fly or re-centre happened');
});

test('while a place is being chosen, tapping an existing star does not open its card; the saved spot is whatever was tapped', async () => {
  render(<AtlasPage />);
  const star = await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  await screen.findByTestId('pin-panel');
  fireEvent.click(star);
  assert.equal(screen.queryByTestId('memory-panel'), null, 'no memory card while pinning');
  assert.ok(screen.getByTestId('pin-panel'));
});

test('cancelling discards the temporary spot and the form, leaves every existing memory alone, and a new pin starts empty', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  await screen.findByTestId('pin-panel');
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Draft I will throw away' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pick Manila' }));
  fireEvent.click(screen.getByTestId('pin-cancel'));
  await waitFor(() => assert.equal(screen.queryByTestId('pin-panel'), null));
  assert.equal(screen.getByTestId('fake-map').getAttribute('data-picking'), 'false', 'selection mode is off');
  assert.equal(screen.getByTestId('picked').textContent, 'none', 'the temporary spot is gone');
  assert.ok(screen.getByRole('button', { name: 'star:Title c1' }), 'existing stars are untouched');
  assert.equal(posts().filter((b) => b.action === 'create' || b.action === 'update' || b.action === 'delete').length, 0, 'nothing was written');
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  await screen.findByTestId('pin-panel');
  assert.equal((screen.getByLabelText('Title') as HTMLInputElement).value, '', 'a new pin starts clean');
  assert.equal(screen.getByTestId('picked').textContent, 'none');
  // Escape cancels too.
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => assert.equal(screen.queryByTestId('pin-panel'), null));
});

test('the spot chosen on the map is what is saved, with no place name sent, and saving ends selection mode', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  await screen.findByTestId('pin-panel');
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'By the bay' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pick Manila' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pick Osaka' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pin this memory' }));
  await waitFor(() => assert.ok(posts().some((b) => b.action === 'create')));
  const created = posts().find((b) => b.action === 'create') as Mem;
  assert.equal(created.lat, 34.6937, 'the pin on the map is the location');
  assert.equal(created.lng, 135.5023);
  assert.equal('placeLabel' in created, false, 'nothing is typed or labelled: no place name goes up');
  await waitFor(() => assert.equal(screen.queryByTestId('pin-panel'), null));
  assert.equal(screen.getByTestId('fake-map').getAttribute('data-picking'), 'false');
});

test('the form has no location fields: no instruction box, no place search, no place name; the map is the only way to choose', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  const panel = await screen.findByTestId('pin-panel');
  assert.equal(within(panel).queryByText(/Where was it/i), null);
  assert.equal(within(panel).queryByText(/Spot chosen on the map/i), null);
  assert.equal(within(panel).queryByTestId('pin-location'), null);
  assert.equal(within(panel).queryByRole('search'), null);
  assert.equal(within(panel).queryByLabelText(/Search for a place/i), null);
  assert.equal(within(panel).queryByRole('button', { name: 'Search' }), null);
  assert.equal(within(panel).queryByLabelText(/Place name/i), null);
  assert.equal(within(panel).queryByPlaceholderText(/neighbourhood or city/i), null);
  fireEvent.click(screen.getByRole('button', { name: 'Pick Manila' }));
  for (const gone of [/Spot chosen on the map/i, /Place name/i, /Search for a place/i]) assert.equal(within(panel).queryByText(gone), null, `still none after choosing a spot: ${gone}`);
  assert.match(screen.getByTestId('pin-hint').textContent ?? '', /Spot chosen/, 'the map itself says so');
  assert.equal(screen.queryByTestId('pin-needs-location'), null, 'and the form stops asking for one');
});

test('editing a memory starts with its own spot already chosen on the map, and can be moved there', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getByRole('tab', { name: 'My memories' }));
  fireEvent.click(await screen.findByRole('button', { name: 'star:My pier' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByTestId('pin-panel');
  assert.equal(screen.getByTestId('picked').textContent, '14.6,120.98', 'its current spot is the starting point');
  assert.equal((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled, false);
  fireEvent.click(screen.getByRole('button', { name: 'Pick Osaka' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.ok(posts().some((b) => b.action === 'update')));
  const updated = posts().find((b) => b.action === 'update') as Mem;
  assert.equal(updated.lat, 34.6937);
  assert.equal(updated.lng, 135.5023);
  assert.equal('placeLabel' in updated, false, 'an edit never sends a place name: the one it has is left as it is');
});

test('saving an edit without moving the pin sends the memory\'s own (already rounded) point back, so its position cannot drift', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getByRole('tab', { name: 'My memories' }));
  fireEvent.click(await screen.findByRole('button', { name: 'star:My pier' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByTestId('pin-panel');
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My pier, renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.ok(posts().some((b) => b.action === 'update')));
  const updated = posts().find((b) => b.action === 'update') as Mem;
  assert.equal(updated.lat, 14.6);
  assert.equal(updated.lng, 120.98);
});

test('the form never opens a dialog over the map, and the add button steps aside while pinning', async () => {
  render(<AtlasPage />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  await screen.findByTestId('pin-panel');
  assert.equal(screen.queryByRole('dialog'), null, 'a panel on the page, not a modal covering the map');
  assert.equal(screen.queryByTestId('floating-add'), null);
  assert.equal(screen.getAllByRole('button', { name: /New memory/ }).every((b) => (b as HTMLButtonElement).disabled), true, 'no second pin can be started');
});

test('editing an anonymous memory keeps its cosmic name; switching to the pseudonym and back before saving still keeps it; the edit sends only the choice', async () => {
  mine = [memory('m1', { mine: true, author: null, visibility: 'public', title: 'My pier', displayIdentity: 'anonymous', displayName: 'Nova', identity: { mode: 'anonymous' } })];
  render(<AtlasPage memberName="Violet Lark" />);
  fireEvent.click(await screen.findByRole('tab', { name: 'My memories' }));
  fireEvent.click(await screen.findByRole('button', { name: 'star:My pier' }));
  fireEvent.click(within(await screen.findByTestId('memory-panel')).getByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Save changes' });
  const identity = screen.getByTestId('atlas-identity');
  assert.match(screen.getByTestId('atlas-identity-preview').textContent ?? '', /Shown as Nova/);
  fireEvent.click(within(identity).getByRole('radio', { name: /My pseudonym/ }));
  assert.match(screen.getByTestId('atlas-identity-preview').textContent ?? '', /Violet Lark/, 'switching shows the member\'s own pseudonym');
  fireEvent.click(within(identity).getByRole('radio', { name: /Anonymous/ }));
  assert.match(screen.getByTestId('atlas-identity-preview').textContent ?? '', /Nova/, 'back to anonymous before saving: nothing was changed, so the name is kept');
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My pier, renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.ok(posts().some((b) => b.action === 'update')));
  const updated = posts().find((b) => b.action === 'update') as Mem;
  assert.deepEqual(updated.displayIdentity, { mode: 'anonymous' });
  assert.equal('anonymousAlias' in updated || 'alias' in updated || 'displayName' in updated, false, 'the app never sends a name: the server keeps the one it stored');
});

test('switching a pseudonym memory to Anonymous drops the shown-as line (a new cosmic name is picked on save)', async () => {
  mine = [memory('m1', { mine: true, author: null, visibility: 'public', title: 'My pier', displayIdentity: 'profile', displayName: 'You', identity: { mode: 'profile' } })];
  render(<AtlasPage memberName="Violet Lark" />);
  fireEvent.click(await screen.findByRole('tab', { name: 'My memories' }));
  fireEvent.click(await screen.findByRole('button', { name: 'star:My pier' }));
  fireEvent.click(within(await screen.findByTestId('memory-panel')).getByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Save changes' });
  fireEvent.click(within(screen.getByTestId('atlas-identity')).getByRole('radio', { name: /Anonymous/ }));
  assert.equal(screen.queryByTestId('atlas-identity-preview'), null);
  assert.doesNotMatch(screen.getByTestId('atlas-identity').textContent ?? '', /Violet Lark/);
});

test('the ATLAS layout does not move when a text field is focused: its height uses the steady tab-bar space, so the form sheet cannot jump away from a finger that is about to tap Save', () => {
  const page = fs.readFileSync('src/components/AtlasPage.tsx', 'utf8').replace(/\r\n/g, '\n');
  assert.match(page, /h-\[calc\(100dvh-var\(--header-h\)-var\(--tabbar-h-steady\)\)\]/);
  assert.equal(/h-\[calc\(100dvh-var\(--header-h\)-var\(--tabbar-h\)\)\]/.test(page), false, 'the page height does not follow --tabbar-h (which drops to 0 while typing)');
  const css = fs.readFileSync('src/index.css', 'utf8').replace(/\r\n/g, '\n');
  assert.match(css, /--tabbar-h-steady: calc\(3\.5rem \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(css, /--header-h: 4rem;\n\s+--tabbar-h: 0px;\n\s+--tabbar-h-steady: 0px;/, 'and it is 0 where there is no tab bar (desktop), like --tabbar-h');
  const typing = css.slice(css.indexOf('Hide the tab bar while typing'), css.indexOf('Hide the tab bar while typing') + 600);
  assert.equal(typing.includes('--tabbar-h-steady'), false, 'the focus rule only changes --tabbar-h, never the steady one');
});

test('REGRESSION: the Community map shows the member\'s own public memory as a star (the page never filters records out), and opens it with the owner\'s controls', async () => {
  community = [memory('own1', { mine: true, author: null, lat: 10.1, lng: 20.2, title: 'I published this', displayIdentity: 'anonymous', displayName: 'Nova', identity: { mode: 'anonymous' } }), memory('c1')];
  render(<AtlasPage />);
  const own = await screen.findByRole('button', { name: 'star:I published this' });
  assert.ok(await screen.findByRole('button', { name: 'star:Title c1' }), 'and the other members\' stars are there too');
  assert.equal(screen.getByRole('tab', { name: 'Community' }).getAttribute('aria-selected'), 'true');
  fireEvent.click(own);
  const card = await screen.findByTestId('memory-panel');
  assert.ok(within(card).getByRole('button', { name: 'Edit' }), 'it is theirs, so they can edit it from Community');
  assert.match(within(card).getByTestId('memory-identity').textContent ?? '', /Shown as Nova/);
});

// ----------------------------------------------------------------------------------------------- the compact card and its engagement

const panelFor = (memories: Mem[], busy: string | null = null) => render(
  <MemoryPanel group={{ key: 'k', lat: 14.6, lng: 120.98, memories } as never} onClose={() => {}} onEdit={() => {}} onDelete={() => {}} photoVersions={{}} busyId={busy} />,
);

test('the compact card: date right under the words, no close button, title and words as the focus, place name plain, no "Shared", no dividers, no exact spot', async () => {
  panelFor([memory('k1', { date: '2024-06-01', placeLabel: 'Manila Bay', lat: 14.6, lng: 120.98 })]);
  const card = screen.getByTestId('memory-panel');
  const date = within(card).getByTestId('memory-date');
  const words = within(card).getByText('Words k1');
  assert.ok(words.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING, 'the date comes after the memory text');
  assert.equal(date.previousElementSibling, words, 'directly below it');
  assert.equal(card.querySelector('header'), null, 'no top row for a single memory');
  assert.equal(within(card).queryByRole('button', { name: 'Close memory' }), null, 'no close button');
  assert.match(date.textContent ?? '', /Jun(e)? 1, 2024/, 'a short date');
  assert.equal(date.getAttribute('datetime'), '2024-06-01');
  assert.ok(within(card).getByRole('heading', { name: 'Title k1' }));
  assert.ok(within(card).getByText('Words k1'));
  assert.equal(within(card).getByTestId('memory-place').textContent, 'Manila Bay');
  const everything = card.textContent ?? '';
  assert.doesNotMatch(everything, /approximate/i, 'no "Approximate area" and no "approximate"');
  assert.doesNotMatch(everything, /\bShared\b/, 'no "Shared" label');
  assert.doesNotMatch(everything, /14\.6|120\.98|lat|lng/i, 'no coordinates anywhere on the card');
  assert.equal(card.querySelectorAll('[class*="border-t"], hr').length, 0, 'no divider lines inside the card');
  assert.doesNotMatch(card.innerHTML, /(?:^|[\s"])(pb-4|space-y-3|py-4|pt-3|border-t)(?=[\s"])/, 'the roomy paddings of the old card are gone');
  await waitFor(() => assert.ok(calls.some((c) => c.body?.action === 'view')));
});

test('a memory with no place name shows no place line at all (nothing to say, nothing invented); a memory with no date shows no date', () => {
  panelFor([memory('k2', { placeLabel: '', date: null })]);
  const card = screen.getByTestId('memory-panel');
  assert.equal(within(card).queryByTestId('memory-place'), null);
  assert.equal(within(card).queryByTestId('memory-date'), null);
  assert.doesNotMatch(card.textContent ?? '', /approximate|area/i);
});

test('the author row is compact: a small star beside an anonymous cosmic name (no avatar, no profile link); a profile author is a small avatar and name', () => {
  const first = panelFor([memory('k3', { displayIdentity: 'anonymous', displayName: 'Supernova', author: null })]);
  const card = screen.getByTestId('memory-panel');
  assert.equal(within(card).getByTestId('memory-author-name').textContent, 'Supernova', 'the cosmic name stays visible');
  const star = card.querySelector('footer .atlas-dot') as HTMLElement;
  assert.ok(star, 'a small star sits beside the name');
  assert.match(star.className, /!h-2\.5 !w-2\.5/, 'about 10px, much smaller than before');
  assert.equal(card.querySelectorAll('footer img, footer a, footer button[aria-label*="profile" i]').length, 0, 'nothing that points at the account');
  assert.equal(card.querySelector('footer .h-9.w-9'), null, 'the old 36px badge is gone');
  first.unmount();
  panelFor([memory('k4', {})]);
  const named = screen.getByTestId('memory-panel');
  assert.ok(within(named).getByText('Willow'));
  assert.equal(named.querySelector('footer .h-9.w-9'), null);
});

test('opening a card counts a view once, shows the totals with an eye, and stepping back to a memory already opened does not ask again', async () => {
  engagement = { k5: { views: 4, hugs: 2, hearts: 1, mine: null } };
  panelFor([memory('k5', { createdAt: 9 }), memory('k6', { createdAt: 5 })]);
  const card = screen.getByTestId('memory-panel');
  await waitFor(() => assert.equal(within(card).getByTestId('memory-views').getAttribute('aria-label'), '5 views'), { timeout: 4000 });
  assert.equal(within(card).getByTestId('memory-views').textContent, '5');
  assert.equal(within(card).getByTestId('reaction-hug').textContent?.includes('2'), true);
  assert.equal(within(card).getByTestId('reaction-heart').textContent?.includes('1'), true);
  assert.equal(posts().filter((b) => b.action === 'view').length, 1);
  fireEvent.click(within(card).getByRole('button', { name: 'Next memory' }));
  await waitFor(() => assert.equal(posts().filter((b) => b.action === 'view').length, 2));
  fireEvent.click(within(card).getByRole('button', { name: 'Previous memory' }));
  await waitFor(() => assert.equal(within(card).getByTestId('memory-views').getAttribute('aria-label'), '5 views'));
  assert.equal(posts().filter((b) => b.action === 'view').length, 2, 'memory k5 was already opened here');
  assert.deepEqual(posts().filter((b) => b.action === 'view').map((b) => b.id), ['k5', 'k6']);
});

test('reactions: one hug OR heart; the choice shows at once; the other switches it; the same again takes it back; totals follow', async () => {
  engagement = { k7: { views: 1, hugs: 0, hearts: 0, mine: null } };
  panelFor([memory('k7')]);
  const card = screen.getByTestId('memory-panel');
  await waitFor(() => assert.equal(within(card).getByTestId('memory-views').textContent, '2'));
  const hug = within(card).getByTestId('reaction-hug');
  const heart = within(card).getByTestId('reaction-heart');
  assert.equal(hug.getAttribute('aria-pressed'), 'false');
  fireEvent.click(hug);
  assert.equal(hug.getAttribute('aria-pressed'), 'true', 'the choice shows immediately');
  assert.match(hug.textContent ?? '', /1/);
  await waitFor(() => assert.deepEqual(posts().filter((b) => b.action === 'react').map((b) => b.kind), ['hug']));
  await waitFor(() => assert.equal(hug.getAttribute('aria-label'), 'Hug, 1'));
  fireEvent.click(heart);
  assert.equal(heart.getAttribute('aria-pressed'), 'true');
  assert.equal(hug.getAttribute('aria-pressed'), 'false', 'only one reaction at a time');
  assert.match(hug.textContent ?? '', /0/);
  await waitFor(() => assert.equal(heart.getAttribute('aria-label'), 'Heart, 1'));
  fireEvent.click(heart);
  assert.equal(heart.getAttribute('aria-pressed'), 'false', 'tapping the chosen one takes it back');
  await waitFor(() => assert.deepEqual(posts().filter((b) => b.action === 'react').map((b) => b.kind), ['hug', 'heart', null]));
  await waitFor(() => assert.equal(heart.getAttribute('aria-label'), 'Heart, 0'));
  assert.equal(within(card).getByRole('group', { name: 'Reactions' }).querySelectorAll('button').length, 2, 'just the two buttons');
});

test('reactions: a second tap while one is being saved is ignored (no duplicates); a failed save puts the count back and says so', async () => {
  let release: () => void = () => {};
  reactGate = new Promise<void>((resolve) => { release = resolve; });
  panelFor([memory('k8')]);
  const card = screen.getByTestId('memory-panel');
  const hug = within(card).getByTestId('reaction-hug');
  const heart = within(card).getByTestId('reaction-heart');
  fireEvent.click(hug); fireEvent.click(hug); fireEvent.click(heart); fireEvent.click(hug);
  release();
  await waitFor(() => assert.equal(hug.getAttribute('aria-label'), 'Hug, 1'));
  assert.equal(posts().filter((b) => b.action === 'react').length, 1, 'one request for a burst of taps');
  assert.equal(heart.getAttribute('aria-label'), 'Heart, 0');
  // the server refuses: the count goes back and the member is told
  reactGate = null; reactStatus = 429;
  fireEvent.click(heart);
  assert.equal(heart.getAttribute('aria-pressed'), 'true', 'optimistic first');
  await waitFor(() => assert.ok(within(card).getByText('Not saved')));
  assert.equal(heart.getAttribute('aria-pressed'), 'false', 'put back');
  assert.equal(hug.getAttribute('aria-pressed'), 'true', 'the earlier hug is untouched');
  assert.equal(heart.getAttribute('aria-label'), 'Heart, 0');
});

test('the author sees the totals but cannot react to their own memory (no buttons, nothing sent); the owner controls and identity stay', async () => {
  engagement = { m9: { views: 12, hugs: 3, hearts: 0, mine: null } };
  panelFor([memory('m9', { mine: true, author: null, identity: { mode: 'profile' } })]);
  const card = screen.getByTestId('memory-panel');
  await waitFor(() => assert.equal(within(card).getByTestId('memory-views').textContent, '13'));
  assert.equal(within(card).queryAllByRole('button', { name: /^(Hug|Heart)/ }).length, 0, 'no reaction buttons on your own memory');
  assert.match(within(card).getByTestId('reaction-hug').getAttribute('aria-label') ?? '', /3 hugs/);
  assert.equal(within(card).queryByTestId('reaction-heart'), null, 'a zero total is not shown to the author');
  assert.ok(within(card).getByRole('button', { name: 'Edit' }));
  assert.ok(within(card).getByRole('button', { name: 'Delete' }));
  assert.match(within(card).getByTestId('memory-identity').textContent ?? '', /Shown as your pseudonym/);
  assert.equal(posts().some((b) => b.action === 'react'), false);
});

test('engagement strip: counts are compact, an unreachable server leaves the totals from the list, and no member is ever named', async () => {
  respond = (body) => (body.action === 'view' ? { status: 503, json: {} } : null);
  panelFor([memory('k10', { views: 1200, hugs: 15000, hearts: 7 })]);
  const card = screen.getByTestId('memory-panel');
  await waitFor(() => assert.ok(calls.some((c) => c.body?.action === 'view')));
  assert.equal(within(card).getByTestId('memory-views').textContent, '1.2k');
  assert.equal(within(card).getByTestId('reaction-hug').textContent?.includes('15k'), true);
  assert.equal(within(card).getByTestId('reaction-heart').textContent?.includes('7'), true);
  assert.equal(within(card).getByTestId('memory-views').getAttribute('aria-label'), '1200 views');
  assert.equal(within(card).queryByText(/viewed by|reacted by/i), null);
});

test('on a phone the round "New memory" button steps aside while a memory card is open (it would cover the reactions), and returns when the card closes', async () => {
  render(<AtlasPage />);
  const star = await screen.findByRole('button', { name: 'star:Title c1' });
  const buttons = () => screen.getAllByRole('button', { name: /New memory/ });
  const before = buttons().length;
  assert.ok(buttons().some((b) => /fixed/.test(b.className)), 'the floating button is there with no card open');
  fireEvent.click(star);
  const card = await screen.findByTestId('memory-panel');
  assert.equal(buttons().some((b) => /fixed/.test(b.className)), false, 'gone while a card is open');
  assert.equal(buttons().length, before - 1);
  await new Promise((r) => setTimeout(r, 10));
  fireEvent.click(document.body);
  await waitFor(() => assert.equal(screen.queryByTestId('memory-panel'), null));
  assert.ok(buttons().some((b) => /fixed/.test(b.className)), 'back once it is closed');
});

test('tapping or clicking outside the card dismisses it; presses inside (reactions, links) and drags do not; Escape works too', async () => {
  const closed: string[] = [];
  render(<div><button type="button">outside</button><MemoryPanel group={{ key: 'k', lat: 1, lng: 1, memories: [memory('d1')] } as never} onClose={() => closed.push('x')} onEdit={() => {}} onDelete={() => {}} photoVersions={{}} busyId={null} /></div>);
  const card = screen.getByTestId('memory-panel');
  await new Promise((r) => setTimeout(r, 10));
  fireEvent.click(within(card).getByRole('heading'));
  fireEvent.click(within(card).getByTestId('reaction-hug'));
  assert.equal(closed.length, 0, 'clicks inside the card never dismiss it');
  fireEvent.pointerDown(screen.getByText('outside'), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByText('outside'), { clientX: 60, clientY: 10 });
  assert.equal(closed.length, 0, 'a drag (the map being panned) is not a dismissal');
  fireEvent.pointerDown(within(card).getByRole('heading'), { clientX: 5, clientY: 5 });
  fireEvent.click(screen.getByText('outside'), { clientX: 5, clientY: 5 });
  assert.equal(closed.length, 0, 'a press that began inside the card is not a dismissal');
  fireEvent.pointerDown(screen.getByText('outside'), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByText('outside'), { clientX: 12, clientY: 11 });
  assert.equal(closed.length, 1, 'a tap outside dismisses');
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(closed.length, 2, 'Escape dismisses');
});

test('the composer is minimal: title, story with the photo and date in its corner, a compact Post as selector; no separate date or picture sections, no big cards', async () => {
  render(<AtlasPage memberName="Violet Lark" />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  const panel = await screen.findByTestId('pin-panel');
  const text = panel.textContent ?? '';
  assert.doesNotMatch(text, /Who should it say|Picture \(optional\)|\(optional\)|Every memory on ATLAS/);
  const story = within(panel).getByLabelText('Story');
  const editor = story.parentElement as HTMLElement;
  const photoBtn = within(editor).getByRole('button', { name: 'Add a picture' });
  const date = within(editor).getByLabelText('Date of the memory') as HTMLInputElement;
  assert.ok(editor.contains(photoBtn) && editor.contains(date), 'photo and date live inside the story editor');
  assert.equal(date.type, 'date');
  assert.equal(within(editor).getByText(/^0\/\d+$/).textContent, '0/1000', 'a subtle counter');
  assert.equal(within(panel).getAllByRole('radio').length, 2);
  assert.equal(within(panel).getByTestId('atlas-identity').querySelector('legend')?.textContent, 'Post as');
});

test('changing Post as keeps what was typed (title, story, date); tapping the date opens the native picker; the shown date follows the field', async () => {
  render(<AtlasPage memberName="Violet Lark" />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  const panel = await screen.findByTestId('pin-panel');
  fireEvent.change(within(panel).getByLabelText('Title'), { target: { value: 'Kept title' } });
  fireEvent.change(within(panel).getByLabelText('Story'), { target: { value: 'Kept story' } });
  const date = within(panel).getByLabelText('Date of the memory') as HTMLInputElement;
  let opened = 0;
  (date as unknown as { showPicker: () => void }).showPicker = () => { opened += 1; };
  fireEvent.click(date);
  assert.equal(opened, 1, 'a tap on the date opens the existing date picker');
  fireEvent.change(date, { target: { value: '2024-06-01' } });
  assert.match(within(panel).getByTestId('atlas-date-text').textContent ?? '', /Jun(e)? 1, 2024/);
  fireEvent.click(within(panel).getByRole('radio', { name: /Anonymous/ }));
  fireEvent.click(within(panel).getByRole('radio', { name: /My pseudonym/ }));
  assert.equal((within(panel).getByLabelText('Title') as HTMLInputElement).value, 'Kept title');
  assert.equal((within(panel).getByLabelText('Story') as HTMLTextAreaElement).value, 'Kept story');
  assert.equal((within(panel).getByLabelText('Date of the memory') as HTMLInputElement).value, '2024-06-01');
});
