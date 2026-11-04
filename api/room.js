// Galaxy Room endpoint (POST only). Room text still goes straight to Firestore; GIFs go through here. See api/_room.js.
//   { action: "send-gif", gifId, messageId? }  -> { id, kind: "gif", gif }
// GIF search and trending are the existing GET /api/signals?view=gifs (one GIPHY integration, one key).
import { authenticate, send, sendError } from './_lib.js';
import { sendRoomGif } from './_room.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  try {
    const { uid, db } = await authenticate(req);
    if (req.body?.action !== 'send-gif') return send(res, 400, { error: 'invalid_request' });
    return send(res, 201, await sendRoomGif(db, uid, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}
