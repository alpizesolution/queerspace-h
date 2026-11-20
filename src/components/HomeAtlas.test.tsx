import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Hero } from './Hero.tsx';
import { NAV_ITEMS } from './BottomNavigation.tsx';

afterEach(cleanup);

const noop = () => {};

test('ATLAS is the first featured section on Home, above Galaxy, Echoes and Cosmos, and opens its page', () => {
  let opened = 0;
  render(<Hero onStartChat={noop} onCustomMatch={noop} onOpenPublicRoom={noop} onOpenCommunity={noop} onOpenUnsaid={noop} onOpenAtlas={() => { opened += 1; }} />);
  const atlas = screen.getByTestId('home-atlas');
  const order = [atlas, screen.getByRole('button', { name: /Galaxy/ }), screen.getByRole('button', { name: /Echoes/ }), screen.getByRole('button', { name: /Cosmos/ })];
  for (let i = 0; i < order.length - 1; i += 1) assert.ok(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING, `${i} is before ${i + 1}`);
  assert.match(atlas.textContent ?? '', /ATLAS/);
  assert.match(atlas.textContent ?? '', /Every place has a story\. Every story leaves a mark\./);
  fireEvent.click(atlas);
  assert.equal(opened, 1);
});

test('the bottom navigation keeps exactly six items, with ATLAS in the sixth place', () => {
  assert.deepEqual(NAV_ITEMS.map((item) => item.label), ['Home', 'Seek', 'Galaxy', 'Echoes', 'Cosmos', 'Atlas']);
});

test('the other Home cards still open Galaxy, Echoes and Cosmos', () => {
  const calls: string[] = [];
  render(<Hero onStartChat={noop} onCustomMatch={noop} onOpenPublicRoom={() => calls.push('public')} onOpenCommunity={() => calls.push('community')} onOpenUnsaid={() => calls.push('unsaid')} onOpenAtlas={noop} />);
  fireEvent.click(screen.getByRole('button', { name: /Galaxy/ }));
  fireEvent.click(screen.getByRole('button', { name: /Echoes/ }));
  fireEvent.click(screen.getByRole('button', { name: /Cosmos/ }));
  assert.deepEqual(calls, ['public', 'unsaid', 'community']);
});
