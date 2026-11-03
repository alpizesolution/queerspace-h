// A small S3-compatible server on localhost that REJECTS any request whose signature or payload hash is wrong. It lets the
// tests send real HTTP requests through the real R2 client (headers, body, signing) without any Cloudflare account.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { signV4 } from '../../api/_media.js';

export async function startFakeS3({ bucket = 'queerspace', accessKeyId = 'TESTKEYID', secretAccessKey = 'test-secret-access-key' } = {}) {
  const objects = new Map();
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://local');
    const authorization = req.headers.authorization || '';
    const signedNames = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(';') ?? [];
    const headers = Object.fromEntries(signedNames.map((name) => [name, req.headers[name]]));
    const expected = signV4({
      method: req.method, path: url.pathname, query: url.search.slice(1), headers, payloadHash: req.headers['x-amz-content-sha256'],
      accessKeyId, secretAccessKey, region: 'auto', service: 's3', amzDate: req.headers['x-amz-date'],
    });
    const payloadMatches = createHash('sha256').update(body).digest('hex') === req.headers['x-amz-content-sha256'];
    requests.push({ method: req.method, path: url.pathname, authorized: authorization === expected && payloadMatches });
    const send = (status, text = '') => { res.statusCode = status; res.end(text); };
    if (authorization !== expected || !payloadMatches) return send(403, '<Error><Code>SignatureDoesNotMatch</Code></Error>');
    const prefix = `/${bucket}/`;
    if (!url.pathname.startsWith(prefix)) return send(404, '<Error><Code>NoSuchBucket</Code></Error>');
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    if (req.method === 'PUT') { objects.set(key, { body, contentType: req.headers['content-type'] }); return send(200); }
    if (req.method === 'GET') {
      const found = objects.get(key);
      if (!found) return send(404, '<Error><Code>NoSuchKey</Code></Error>');
      res.setHeader('content-type', found.contentType || 'application/octet-stream');
      return send(200, found.body);
    }
    if (req.method === 'DELETE') { objects.delete(key); return send(204); }
    return send(405);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { endpoint: `http://127.0.0.1:${port}`, bucket, accessKeyId, secretAccessKey, objects, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}
