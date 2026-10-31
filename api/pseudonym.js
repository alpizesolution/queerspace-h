// Trusted pseudonym reservations. The app proposes names; only this endpoint decides who holds one.
//   action "suggest": the first of up to 12 names nobody holds (reads only, nothing is reserved)
//   action "reserve": gives the caller the first free name from `names`; `allowSuffix` is for app-generated names
import { HttpError, authenticate, rateLimit, send, sendError } from './_lib.js';
import { cleanName, isAvailable, reserveFirstFree } from './_pseudonym.js';

const MAX_NAMES = 12;

function namesFrom(body) {
  const names = Array.isArray(body.names) ? body.names.slice(0, MAX_NAMES) : [];
  if (!names.length) throw new HttpError(400, 'invalid_name');
  return names;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  try {
    const { uid, db } = await authenticate(req);
    const { action } = req.body || {};

    if (action === 'suggest') {
      await rateLimit(db, uid, 'pseudonym-suggest', 30, 60_000);
      for (const candidate of namesFrom(req.body).map(cleanName).filter(Boolean)) {
        if (await isAvailable(db, uid, candidate)) return send(res, 200, { name: candidate });
      }
      return send(res, 200, { name: null });
    }

    if (action === 'reserve') {
      await rateLimit(db, uid, 'pseudonym-reserve', 20, 60_000);
      const result = await reserveFirstFree(db, uid, namesFrom(req.body), { allowSuffix: req.body.allowSuffix === true });
      return send(res, 200, result);
    }

    return send(res, 400, { error: 'invalid_request' });
  } catch (error) {
    return sendError(res, error);
  }
}
