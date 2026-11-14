import '../../test/dom-setup.ts';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AboutDeveloperPage } from './AboutDeveloperPage.tsx';
import { Footer } from './Footer.tsx';
import { MenuDrawer } from './MenuDrawer.tsx';
import { hideBmcWidget, resetBmcWidgetForTests, showBmcWidget } from '../utils/bmcWidget.ts';

/**
 * About the Developer (/about) and its Buy Me a Coffee support.
 * The page is open to everyone, its button opens the developer's Buy Me a Coffee page safely in a new tab, and the official
 * floating widget is loaded once however many times the page is opened.
 */
const widgetScripts = () => document.querySelectorAll('script[data-name="BMC-Widget"]');
afterEach(() => {
  cleanup();
  widgetScripts().forEach((s) => s.remove());
  document.documentElement.classList.remove('bmc-widget-visible');
  resetBmcWidgetForTests();
});
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

test('the page introduces the developer, the project and the thank-you, and Back leaves it', () => {
  let backs = 0;
  render(<AboutDeveloperPage onBack={() => { backs++; }} />);
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Your Space. Your People. Built with Love.' }));
  assert.ok(screen.getByRole('heading', { name: 'Hey there! I’m Cha, creator of QueerSpace PH.' }));
  assert.ok(screen.getByRole('heading', { name: 'Independently maintained' }));
  assert.ok(screen.getByRole('heading', { name: 'Thank you for being here' }));
  assert.ok(screen.getByRole('heading', { name: /Help Keep QueerSpace Alive/ }));
  const portrait = screen.getByRole('img', { name: 'Illustrated portrait of Cha' });
  assert.equal(portrait.getAttribute('src'), '/assets/cha-avatar.gif');
  assert.ok(fs.existsSync('public/assets/cha-avatar.gif'), 'the portrait ships with the app');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  assert.equal(backs, 1);
});

test('the support button opens the Buy Me a Coffee page in a new tab without handing it the opener', () => {
  render(<AboutDeveloperPage onBack={() => {}} />);
  const link = screen.getByRole('link', { name: /Buy me a coffee/ });
  assert.equal(link.getAttribute('href'), 'https://www.buymeacoffee.com/donotdm');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
});

test('the widget script is added once with the official settings, however often the page is opened', () => {
  for (let i = 0; i < 3; i++) {
    const view = render(<AboutDeveloperPage onBack={() => {}} />);
    assert.ok(document.documentElement.classList.contains('bmc-widget-visible'), 'shown while the page is open');
    view.unmount();
    assert.equal(document.documentElement.classList.contains('bmc-widget-visible'), false, 'hidden once it is left');
  }
  showBmcWidget();
  hideBmcWidget();
  const scripts = widgetScripts();
  assert.equal(scripts.length, 1);
  const script = scripts[0] as HTMLScriptElement;
  assert.equal(script.src, 'https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js');
  assert.deepEqual({ ...script.dataset }, {
    name: 'BMC-Widget', cfasync: 'false', id: 'donotdm', description: 'Support me on Buy me a coffee!', message: '',
    color: '#BD5FFF', position: 'Right', x_margin: '18', y_margin: '18',
  });
});

test('the page is reachable from the footer and the phone menu, not from the main tabs', () => {
  const opened: string[] = [];
  render(<Footer onOpenModal={() => {}} onOpenSupport={() => {}} onOpenWhatsNew={() => {}} onOpenAbout={() => opened.push('footer')} />);
  fireEvent.click(screen.getByRole('button', { name: 'About the Developer' }));
  cleanup();
  let closed = 0;
  render(
    <MenuDrawer onClose={() => { closed++; }} onOpenInfo={() => {}} onOpenSupport={() => {}} onOpenAbout={() => opened.push('menu')}
      onOpenProfile={() => {}} onOpenSettings={() => {}} onOpenWhatsNew={() => {}} isSoundMuted={false} onToggleSound={() => {}} showAdmin={false} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'About the Developer' }));
  assert.deepEqual(opened, ['footer', 'menu']);
  assert.equal(closed, 1, 'the menu closes as the page opens');
  assert.doesNotMatch(read('src/components/BottomNavigation.tsx'), /about/i);
});

test('/about opens directly, and the security policy allows only the hosts the widget needs', () => {
  const vercel = JSON.parse(read('vercel.json'));
  for (const source of ['/about', '/about/']) {
    assert.ok(vercel.rewrites.some((r: { source: string; destination: string }) => r.source === source && r.destination === '/'), source);
  }
  const csp: string = vercel.headers.flatMap((h: { headers: { key: string; value: string }[] }) => h.headers)
    .find((h: { key: string }) => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /script-src [^;]*https:\/\/cdnjs\.buymeacoffee\.com/);
  assert.match(csp, /img-src [^;]*https:\/\/cdn\.buymeacoffee\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/www\.buymeacoffee\.com https:\/\/buymeacoffee\.com[ ;]/, 'the panel redirects to the bare domain');
  assert.doesNotMatch(csp, /connect-src [^;]*buymeacoffee/, 'the app itself never calls Buy Me a Coffee');
  assert.doesNotMatch(csp, /\*\.buymeacoffee\.com/, 'no wildcard hosts');
  assert.match(read('src/App.tsx'), /\(ageGateOpen && currentView !== 'about'\) \|\| \(ageRestricted && !supportOpen\)/, 'a new visitor can read the page; an under-18 device stays gated');
  const css = read('src/index.css');
  assert.match(css, /html:not\(\.bmc-widget-visible\) #bmc-wbtn/, 'hidden everywhere but the About page');
  assert.match(css, /#bmc-wbtn \{\s*bottom: calc\(var\(--tabbar-h\) \+ 18px\) !important;/, 'clear of the phone tab bar');
});
