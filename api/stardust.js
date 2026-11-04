// Stardust endpoint (POST only). All reactions go through here; see api/_stardust.js and docs/stardust.md.
//   { action: "give" | "remove", postType: "community" | "lookingFor", postId }  -> { given, count, changed }
//   { action: "state", postType, postIds: [...] }                               -> { given: [ids the member has given to] }
import { authenticate, send, sendError } from './_lib.js';
import { givenAmong, setStardust } from './_stardust.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  try {
    const { uid, db } = await authenticate(req);
    const { action, postType, postId, postIds } = req.body || {};
    if (action === 'give' || action === 'remove') return send(res, 200, await setStardust(db, uid, { postType, postId, give: action === 'give' }));
    if (action === 'state') return send(res, 200, await givenAmong(db, uid, { postType, postIds }));
    return send(res, 400, { error: 'invalid_request' });
  } catch (error) {
    return sendError(res, error);
  }
}
