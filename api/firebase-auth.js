/**
 * First-party proxy for Firebase Auth's sign-in helper pages (/__/auth/*, /__/firebase/*).
 *
 * Safari and iOS block the storage that Google sign-in needs when the helper lives on
 * <project>.firebaseapp.com, so the sign-in "works" and then lands back on the sign-in
 * screen. Serving the helper from our own domain fixes that. It only takes effect once
 * VITE_FIREBASE_AUTH_DOMAIN is set to the site's own domain (see vercel.json rewrites).
 * https://firebase.google.com/docs/auth/web/redirect-best-practices
 */
export const config = { runtime: 'edge' };

const ALLOWED = /^__\/(auth|firebase)\/[A-Za-z0-9._\-/]*$/;
const PASS_REQUEST = ['accept', 'accept-language', 'content-type', 'cookie', 'user-agent'];
const PASS_RESPONSE = ['content-type', 'cache-control', 'location', 'set-cookie', 'etag', 'last-modified', 'expires'];

export function upstreamUrl(requestUrl, projectId) {
  const url = new URL(requestUrl);
  const path = url.searchParams.get('p') ?? '';
  if (!projectId || !ALLOWED.test(path) || path.includes('..')) return null;
  url.searchParams.delete('p');
  const query = url.searchParams.toString();
  return `https://${projectId}.firebaseapp.com/${path}${query ? `?${query}` : ''}`;
}

export default async function handler(request) {
  const target = upstreamUrl(request.url, process.env.VITE_FIREBASE_PROJECT_ID);
  if (!target) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  for (const name of PASS_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  });

  const out = new Headers();
  for (const name of PASS_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
