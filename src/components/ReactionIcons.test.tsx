import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ReactionIcon, REACTION_ICON_PX, CRY_OUTLINE_SRC } from './ReactionIcons.tsx';
import { UNSAID_REACTIONS } from '../services/unsaidService.ts';

afterEach(cleanup);

const DRAWN = UNSAID_REACTIONS.filter((t) => t !== 'cry');

test('every one of the six reactions renders an icon of the same 20px size, hidden from screen readers', () => {
  for (const type of UNSAID_REACTIONS) {
    const { container, unmount } = render(<ReactionIcon type={type} />);
    const icon = container.firstElementChild as HTMLElement | SVGElement;
    assert.ok(icon, `${type} renders`);
    assert.equal(icon.getAttribute('aria-hidden'), 'true', `${type} is decorative`);
    if (type === 'cry') {
      const span = icon as HTMLElement;
      assert.equal(span.tagName, 'SPAN');
      assert.equal(span.style.width, `${REACTION_ICON_PX}px`);
      assert.equal(span.style.height, `${REACTION_ICON_PX}px`);
    } else {
      assert.equal(icon.tagName.toLowerCase(), 'svg', `${type} is an SVG`);
      assert.equal(icon.getAttribute('focusable'), 'false');
      assert.equal(icon.getAttribute('width'), String(REACTION_ICON_PX), `${type} width`);
      assert.equal(icon.getAttribute('height'), String(REACTION_ICON_PX), `${type} height`);
    }
    unmount();
  }
});

test('the five drawn icons are thin monochrome line art: stroke in the current colour, nothing filled, nothing coloured', () => {
  for (const type of DRAWN) {
    const { container, unmount } = render(<ReactionIcon type={type} />);
    const svg = container.querySelector('svg')!;
    assert.equal(svg.getAttribute('fill'), 'none', `${type}: unfilled`);
    assert.equal(svg.getAttribute('stroke'), 'currentColor', `${type}: takes the button colour (muted, accent, light or dark)`);
    assert.equal(svg.getAttribute('stroke-linecap'), 'round');
    assert.equal(svg.getAttribute('stroke-width'), '1.5', `${type}: one thin weight`);
    const shapes = svg.querySelectorAll('path, circle, rect');
    assert.ok(shapes.length > 0, `${type}: has a drawing`);
    for (const shape of shapes) {
      assert.equal(shape.getAttribute('fill'), null, `${type}: no shape sets its own fill`);
      assert.equal(shape.getAttribute('stroke'), null, `${type}: no shape sets its own colour`);
    }
    unmount();
  }
});

test('Crygago is the supplied line art, painted through a mask in the current colour (so it is muted, accent, light or dark like the rest)', () => {
  const { container } = render(<ReactionIcon type="cry" />);
  const span = container.firstElementChild as HTMLElement;
  assert.equal(CRY_OUTLINE_SRC, '/emoji/cry-outline.png');
  assert.match(span.getAttribute('style') ?? '', /cry-outline\.png/);
  assert.ok(span.className.split(' ').includes('bg-current'), 'filled with the current colour, shaped by the mask');
  assert.equal(container.querySelector('img'), null, 'not the colour image');
  assert.equal(container.querySelector('svg'), null, 'not a re-drawing');
});

test('a class passed in is applied to every kind of icon', () => {
  for (const type of ['same', 'cry'] as const) {
    const { container, unmount } = render(<ReactionIcon type={type} className="extra" />);
    assert.ok((container.firstElementChild as Element).getAttribute('class')!.includes('extra'), type);
    unmount();
  }
});
