const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

app.use(express.json({ limit: '10mb' }));

// Serve static assets from root directory
app.use(express.static(__dirname));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Live Website Fetcher
app.post('/api/fetch-url', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL required' });

  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  try {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const request = client.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 SignalSEO/2.6',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 12000
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        let redirectUrl = response.headers.location;
        if (!/^https?:\/\//i.test(redirectUrl)) {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        }
        const redirectClient = redirectUrl.startsWith('https:') ? https : http;
        return redirectClient.get(redirectUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 10000
        }, (res2) => {
          let body = '';
          res2.on('data', chunk => { body += chunk; });
          res2.on('end', () => res.json({ success: true, html: body }));
        }).on('error', e => res.json({ success: false, error: e.message }));
      }

      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => res.json({ success: true, html: data }));
    });

    request.on('error', (e) => res.json({ success: false, error: 'Could not fetch site: ' + e.message }));
    request.on('timeout', () => { request.destroy(); res.json({ success: false, error: 'Fetch timed out' }); });
  } catch (err) {
    res.json({ success: false, error: 'Invalid URL format' });
  }
});

// Groq AI Request Relay
app.post('/api/ai', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required' });
  if (!GROQ_API_KEY) return res.status(500).json({ success: false, error: 'GROQ_API_KEY is not configured on Railway' });

  const payload = JSON.stringify({
    model: 'openai/gpt-oss-20b',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 2500
  });

  const options = {
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const groqReq = https.request(options, (groqRes) => {
    let body = '';
    groqRes.on('data', chunk => { body += chunk; });
    groqRes.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (groqRes.statusCode !== 200) {
          return res.status(groqRes.statusCode).json({ success: false, error: (parsed.error && parsed.error.message) || 'Groq API error' });
        }
        const text = parsed.choices && parsed.choices[0] && parsed.choices[0].message ? parsed.choices[0].message.content : '';
        res.json({ success: true, response: text });
      } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to parse Groq response' });
      }
    });
  });

  groqReq.on('error', (e) => res.status(500).json({ success: false, error: e.message }));
  groqReq.write(payload);
  groqReq.end();
});

// Express 5 compatible catch-all (prevents PathError crash)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Signal Engine active on port ${PORT}`));