const https = require('https');

// Vercel serverless function: proxies /api/* → api.materialsproject.org/*
// Mirrors the local server.js proxy so the frontend's fetch('/api/...') calls
// work identically in both environments.
module.exports = (req, res) => {
  const apiKey = process.env.MP_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MP_API_KEY environment variable is not set' }));
    return;
  }

  const mpPath = req.url.replace(/^\/api/, '');

  const proxyReq = https.request(
    {
      hostname: 'api.materialsproject.org',
      path: mpPath,
      method: 'GET',
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
    },
    mpRes => {
      res.writeHead(mpRes.statusCode, { 'Content-Type': 'application/json' });
      mpRes.pipe(res);
    }
  );

  proxyReq.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  proxyReq.end();
};
