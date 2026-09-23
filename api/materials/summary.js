const https = require('https');

// Vercel serverless function for the one endpoint the frontend actually
// calls. A generic api/[...path].js catch-all was tried first, but this
// deployment's build resolves that bracket syntax as a single dynamic
// segment instead of a true catch-all (multi-segment paths under /api
// never reach the function, edge returns 404 before invocation) — so an
// exact nested path is used instead, matching /api/materials/summary.
module.exports = (req, res) => {
  const apiKey = process.env.MP_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MP_API_KEY environment variable is not set' }));
    return;
  }

  const queryIndex = req.url.indexOf('?');
  const search = queryIndex === -1 ? '' : req.url.slice(queryIndex);

  const proxyReq = https.request(
    {
      hostname: 'api.materialsproject.org',
      path: `/materials/summary/${search}`,
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
