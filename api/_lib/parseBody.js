// Vercel Node serverless functions do not auto-parse JSON bodies on the raw
// IncomingMessage. This helper handles that consistently across all routes.
export async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON body: ' + err.message));
      }
    });
    req.on('error', reject);
  });
}

export function jsonResponse(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export function errorResponse(res, status, message, detail) {
  return jsonResponse(res, status, { error: message, detail: detail || null });
}
