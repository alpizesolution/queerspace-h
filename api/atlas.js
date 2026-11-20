// ATLAS endpoint: a shared map of memories. All the rules live in api/_atlas.js; this only authenticates, routes and answers.
//   POST { action: 'list' | 'create' | 'update' | 'delete', ... }     GET ?view=photo&id=<memoryId>
// Every response is private to the signed-in member and never cached.
import { HttpError, authenticate, send, sendError } from './_lib.js';
import { createMemory, deleteMemory, listMemories, memoryPhoto, updateMemory } from './_atlas.js';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const { uid, db, decoded } = await authenticate(req);
    if (req.method === 'GET') {
      const params = new URL(req.url || '/api/atlas', 'http://localhost').searchParams;
      const view = req.query?.view ?? params.get('view');
      if (view !== 'photo') throw new HttpError(400, 'invalid_view');
      return send(res, 200, await memoryPhoto(db, uid, req.query?.id ?? params.get('id')));
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    switch (body.action) {
      case 'list': return send(res, 200, await listMemories(db, uid, body));
      case 'create': return send(res, 201, await createMemory(db, uid, body));
      case 'update': return send(res, 200, await updateMemory(db, uid, body));
      case 'delete': return send(res, 200, await deleteMemory(db, uid, body, undefined, decoded));
      default: throw new HttpError(400, 'invalid_action');
    }
  } catch (error) {
    return sendError(res, error);
  }
}
