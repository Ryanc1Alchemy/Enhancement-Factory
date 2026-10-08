// Lightweight local API server — mirrors Vercel's serverless routing for local dev.
// This lets us run `vercel`-style /api/*.js handlers with plain Node, no Vercel
// account / login required. Vite proxies /api requests here (see vite.config.js).
import 'dotenv/config';
import http from 'http';
import { URL } from 'url';

import agentHandler from './api/agent.js';
import estimateHandler from './api/estimate.js';
import jiraHandler from './api/jira.js';
import runsHandler from './api/runs.js';

const PORT = process.env.API_PORT || 3001;

const routes = {
  '/api/agent': agentHandler,
  '/api/estimate': estimateHandler,
  '/api/jira': jiraHandler,
  '/api/runs': runsHandler
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const handler = routes[url.pathname];

  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    await handler(req, res);
  } catch (err) {
    console.error('Handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error', detail: err.message }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`[dev-api] Local API server listening on http://localhost:${PORT}`);
  console.log(`[dev-api] ANTHROPIC_API_KEY set: ${Boolean(process.env.ANTHROPIC_API_KEY)}`);
});
