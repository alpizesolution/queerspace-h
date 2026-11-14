/**
 * The one place the Buy Me a Coffee widget is loaded.
 *
 * The official script is added at most once per page load, the first time a screen asks for it. After that, showing and
 * hiding is a class on <html> (see index.css), so moving between screens can never create a second widget.
 * The content security policy in vercel.json allows exactly the hosts this script needs.
 */

const SCRIPT_SRC = 'https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js';
const VISIBLE_CLASS = 'bmc-widget-visible';

const WIDGET_CONFIG: Record<string, string> = {
  name: 'BMC-Widget',
  cfasync: 'false',
  id: 'donotdm',
  description: 'Support me on Buy me a coffee!',
  message: '',
  color: '#BD5FFF',
  position: 'Right',
  x_margin: '18',
  y_margin: '18',
};

let injected = false;

function injectOnce(): void {
  if (injected) return;
  injected = true;
  if (document.querySelector('script[data-name="BMC-Widget"]') || document.getElementById('bmc-wbtn')) return;

  const script = document.createElement('script');
  script.src = SCRIPT_SRC;
  script.async = true;
  for (const [key, value] of Object.entries(WIDGET_CONFIG)) script.dataset[key] = value;
  script.onload = () => {
    // The widget builds its button inside a window-level DOMContentLoaded listener, which fired long ago in this app.
    // Send that event to window only; nothing else here listens for it there.
    if (!document.getElementById('bmc-wbtn')) window.dispatchEvent(new Event('DOMContentLoaded'));
  };
  // Blocked or offline: the page's own Buy Me a Coffee button still works, so stay quiet.
  script.onerror = () => script.remove();
  document.body.appendChild(script);
}

/** Shows the floating widget, loading it on first use. */
export function showBmcWidget(): void {
  if (typeof document === 'undefined') return;
  injectOnce();
  document.documentElement.classList.add(VISIBLE_CLASS);
}

/** Hides the floating widget without removing it. */
export function hideBmcWidget(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.remove(VISIBLE_CLASS);
}

/** For tests: forget that the script was added. */
export function resetBmcWidgetForTests(): void {
  injected = false;
}
