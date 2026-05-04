const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

function readEnv() {
  try {
    const content = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const match = content.match(/^MP_API_KEY=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch { return ''; }
}

const API_KEY = readEnv();
const PORT = 3000;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  // Proxy /api/* → api.materialsproject.org/*
  if (req.url.startsWith('/api/')) {
    const mpPath = req.url.slice(4); // strip /api
    const options = {
      hostname: 'api.materialsproject.org',
      path: mpPath,
      method: 'GET',
      headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
    };

    const proxy = https.request(options, mpRes => {
      res.writeHead(mpRes.statusCode, { 'Content-Type': 'application/json' });
      mpRes.pipe(res);
    });

    proxy.on('error', err => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    proxy.end();
    return;
  }

  // Serve static files
  const filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Materials Explorer → http://localhost:${PORT}`);
  if (!API_KEY) console.error('ERROR: MP_API_KEY not set in .env');
});
