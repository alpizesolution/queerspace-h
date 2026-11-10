import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ReactionIcon, REACTION_ICON_PX } from './ReactionIcons.tsx';
import { UNSAID_REACTIONS } from '../services/unsaidService.ts';

afterEach(cleanup);

test('every one of the six reactions renders an SVG icon of the same size, hidden from screen readers', () => {
  for (const type of UNSAID_REACTIONS) {
    const { container, unmount } = render(<ReactionIcon type={type} />);
    const svg = container.firstElementChild as SVGElement;
    assert.equal(svg.tagName.toLowerCase(), 'svg', `${type} is an SVG`);
    assert.equal(svg.getAttribute('aria-hidden'), 'true', `${type} is decorative`);
    assert.equal(svg.getAttribute('focusable'), 'false');
    assert.equal(svg.getAttribute('width'), String(REACTION_ICON_PX), `${type} width`);
    assert.equal(svg.getAttribute('height'), String(REACTION_ICON_PX), `${type} height`);
    unmount();
  }
});

test('every icon is thin monochrome line art: stroke in the current colour, nothing filled, nothing coloured', () => {
  for (const type of UNSAID_REACTIONS) {
    const { container, unmount } = render(<ReactionIcon type={type} />);
    const svg = container.querySelector('svg')!;
    assert.equal(svg.getAttribute('fill'), 'none', `${type}: unfilled`);
    assert.equal(svg.getAttribute('stroke'), 'currentColor', `${type}: takes the button colour (muted, accent, light or dark)`);
    assert.equal(svg.getAttribute('stroke-linecap'), 'round');
    const shapes = svg.querySelectorAll('path, circle, rect');
    assert.ok(shapes.length > 0, `${type}: has a drawing`);
    for (const shape of shapes) {
      assert.equal(shape.getAttribute('fill'), null, `${type}: no shape sets its own fill`);
      assert.equal(shape.getAttribute('stroke'), null, `${type}: no shape sets its own colour`);
    }
    unmount();
  }
});

test('the line weight is thin and even: 1.5 in the 24-unit icons, and Crygago\'s is scaled to match at 20px', () => {
  const weightAt20 = (type: (typeof UNSAID_REACTIONS)[number]) => {
    const { container, unmount } = render(<ReactionIcon type={type} />);
    const svg = container.querySelector('svg')!;
    const box = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    const px = (Number(svg.getAttribute('stroke-width')) * REACTION_ICON_PX) / box;
    unmount();
    return px;
  };
  for (const type of UNSAID_REACTIONS) {
    const px = weightAt20(type);
    assert.ok(px >= 1 && px <= 1.35, `${type}: about 1.0-1.3px on screen (is ${px.toFixed(2)})`);
  }
});

test('Crygago is drawn in the original artwork\'s 96x96 space, with its face, brows and hands', () => {
  const { container } = render(<ReactionIcon type="cry" />);
  const svg = container.querySelector('svg')!;
  assert.equal(svg.getAttribute('viewBox'), '0 0 96 96');
  assert.ok(svg.querySelectorAll('path').length >= 4);
  assert.equal(container.querySelector('img'), null, 'not the colour image');
});

test('a class passed in is applied, so the icon can be placed without changing it', () => {
  const { container } = render(<ReactionIcon type="same" className="extra" />);
  assert.ok(container.querySelector('svg')!.getAttribute('class')!.includes('extra'));
});
