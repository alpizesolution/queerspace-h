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

beforeEach(() => {
  calls = [];
  community = [memory('c1'), memory('c2', { lat: 35.68, lng: 139.65, title: 'Tokyo night', visibility: 'friends' })];
  recentList = [];
  mine = [memory('m1', { mine: true, author: null, visibility: 'private', title: 'My pier' })];
  respond = () => null;
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: q.includes('min-width: 1024px'), addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Mem) : undefined;
    calls.push({ url: String(url), body });
    const custom = body ? respond(body) : null;
    if (custom) return { ok: custom.status < 300, status: custom.status, json: async () => custom.json };
    if (body?.action === 'list') return { ok: true, status: 200, json: async () => ({ memories: body.scope === 'mine' ? mine : body.scope === 'recent' ? recentList : community, truncated: false }) };
    if (body?.action === 'create') { const m = memory(String(body.id), { ...body, mine: true, author: null }); mine = [m, ...mine]; return { ok: true, status: 201, json: async () => ({ memory: { ...m, lat: 14.6, lng: 120.98 }, replayed: false }) }; }
    if (body?.action === 'update') { mine = mine.map((m) => (m.id === body.id ? { ...m, ...body } : m)); return { ok: true, status: 200, json: async () => ({ memory: mine.find((m) => m.id === body.id) }) }; }
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
  assert.ok(within(card).getByText(/approximate/i), 'the place is shown as approximate');
  assert.ok(within(card).getByText('Willow'));
  assert.equal(within(card).queryByRole('button', { name: 'Edit' }), null, 'no edit or delete on someone else\'s memory');
  assert.equal(within(card).queryByRole('button', { name: 'Delete' }), null);
});

test('an anonymous memory shows its cosmic name and no profile; several memories at one star can be stepped through', async () => {
  community = [memory('a1', { displayIdentity: 'anonymous', displayName: 'Nova', author: null, title: 'Hidden one', createdAt: 5 }), memory('a2', { title: 'Second here', createdAt: 9 })];
  render(<AtlasPage />);
  fireEvent.click(await screen.findByRole('button', { name: /^star:/ }));
  const card = await screen.findByTestId('memory-panel');
  assert.ok(within(card).getByText(/1 of 2 here/));
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
  assert.match(screen.getByTestId('memory-audience').textContent ?? '', /Visible to all QUEERSPACE members/);
  assert.match(screen.getByTestId('memory-identity').textContent ?? '', /Shown as Polaris \(anonymous\)/, 'the author sees the very name others see');
  assert.match(screen.getByTestId('memory-identity').textContent ?? '', /account stays private/);
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
  assert.match(within(panel).getByTestId('atlas-public-note').textContent ?? '', /visible to all QUEERSPACE members/);
});

test('the identity choice is always there with two options: Use my pseudonym (the default, showing the member\'s name) or Anonymous; it changes what will be shown and what is sent', async () => {
  render(<AtlasPage memberName="Violet Lark" />);
  await screen.findByRole('button', { name: 'star:Title c1' });
  fireEvent.click(screen.getAllByRole('button', { name: /New memory/ })[0]);
  await screen.findByRole('button', { name: 'Pin this memory' });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Moon walk' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pick Manila' }));
  const identity = screen.getByTestId('atlas-identity');
  const options = within(identity).getAllByRole('radio');
  assert.deepEqual(options.map((o) => within(o).getByText(/^(Use my pseudonym|Anonymous)$/).textContent), ['Use my pseudonym', 'Anonymous'], 'exactly these two, nothing to type');
  assert.equal(within(identity).queryByRole('textbox'), null, 'no name can be typed');
  assert.equal(within(identity).getByRole('radio', { name: /Use my pseudonym/ }).getAttribute('aria-checked'), 'true', 'the default');
  assert.match(screen.getByTestId('atlas-identity-preview').textContent ?? '', /Violet Lark/);
  assert.match(within(identity).getByRole('radio', { name: /Use my pseudonym/ }).textContent ?? '', /Shown as Violet Lark/);
  fireEvent.click(within(identity).getByRole('radio', { name: /Anonymous/ }));
  assert.equal(within(identity).getByRole('radio', { name: /Anonymous/ }).getAttribute('aria-checked'), 'true');
  assert.equal(within(identity).getByRole('radio', { name: /Use my pseudonym/ }).getAttribute('aria-checked'), 'false');
  assert.match(screen.getByTestId('atlas-identity-preview').textContent ?? '', /a random cosmic name \(picked when you publish\)/);
  assert.match(within(identity).getByRole('radio', { name: /Anonymous/ }).textContent ?? '', /random cosmic name, like Nova, Moonbeam or Polaris/);
  assert.doesNotMatch(screen.getByTestId('atlas-identity-preview').textContent ?? '', /Violet Lark/);
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
  assert.match(screen.getByTestId('atlas-identity-preview').textContent ?? '', /Nova/, 'an anonymous memory keeps the cosmic name it has');
  assert.doesNotMatch(screen.getByTestId('atlas-identity-preview').textContent ?? '', /picked when you/);
  assert.equal(screen.queryByRole('radio', { name: /Only me|Connections|Everyone/ }), null);
  fireEvent.click(within(screen.getByTestId('atlas-identity')).getByRole('radio', { name: /Use my pseudonym/ }));
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
  assert.match(within(identity).getByRole('radio', { name: /Anonymous/ }).textContent ?? '', /Stays Nova/);
  fireEvent.click(within(identity).getByRole('radio', { name: /Use my pseudonym/ }));
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

test('switching a pseudonym memory to Anonymous says a new cosmic name will be picked on save', async () => {
  mine = [memory('m1', { mine: true, author: null, visibility: 'public', title: 'My pier', displayIdentity: 'profile', displayName: 'You', identity: { mode: 'profile' } })];
  render(<AtlasPage memberName="Violet Lark" />);
  fireEvent.click(await screen.findByRole('tab', { name: 'My memories' }));
  fireEvent.click(await screen.findByRole('button', { name: 'star:My pier' }));
  fireEvent.click(within(await screen.findByTestId('memory-panel')).getByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Save changes' });
  fireEvent.click(within(screen.getByTestId('atlas-identity')).getByRole('radio', { name: /Anonymous/ }));
  assert.match(screen.getByTestId('atlas-identity-preview').textContent ?? '', /a new random cosmic name \(picked when you save\)/);
  assert.doesNotMatch(screen.getByTestId('atlas-identity-preview').textContent ?? '', /Violet Lark/);
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
