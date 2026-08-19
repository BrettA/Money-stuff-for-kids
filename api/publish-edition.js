const blob = require('@vercel/blob');
const { MAX_PACKAGE_BYTES, RequestError, createPublisher } = require('./_publish-core');

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, 'request body is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'method not allowed' });
  }
  try {
    const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].toLowerCase();
    const raw = await readBody(request, MAX_PACKAGE_BYTES + 1024);
    let body;
    if (contentType === 'application/json') {
      try { body = JSON.parse(raw.toString('utf8')); } catch { throw new RequestError(400, 'invalid JSON'); }
    } else if (contentType === 'application/zip') {
      body = { edition_id: request.headers['x-edition-id'], package: raw };
    }
    const result = await createPublisher({ blob })({
      authorization: request.headers.authorization, contentType, body
    });
    return response.status(result.status).json(result.data);
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 502;
    if (status === 502) console.error('publish-edition failed', error);
    return response.status(status).json({ error: status === 502 ? 'publishing service unavailable' : error.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
