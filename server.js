require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static files (explicitly excluding index.html automatic catch-all)
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ==========================================
// SEO & BOT CRAWLER ROUTES
// ==========================================

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'robots.txt'), (err) => {
    if (err) res.send("User-agent: *\nAllow: /\nSitemap: https://signal-seo-tool.up.railway.app/sitemap.xml");
  });
});

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, 'sitemap.xml'), (err) => {
    if (err) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://signal-seo-tool.up.railway.app/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
    }
  });
});

// ==========================================
// CORE API ENDPOINTS (MUST BE BEFORE FALLBACK)
// ==========================================

const handleFetchUrl = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    let { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required.' });
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const startTime = Date.now();
    const fetchResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SignalSEO/2.6'
      },
      redirect: 'follow'
    });

    const loadTimeMs = Date.now() - startTime;
    const html = await fetchResponse.text();

    return res.json({
      url,
      status: fetchResponse.status,
      statusCode: fetchResponse.status,
      loadTime: loadTimeMs,
      loadTimeMs,
      html,
      content: html
    });
  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({ error: `Failed to fetch target URL: ${err.message}` });
  }
};

// Handle both route variations
app.post('/api/fetch-url', handleFetchUrl);
app.post('/fetch-url', handleFetchUrl);

// Groq AI Endpoint
app.post('/api/groq', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is missing on server.' });
    }

    const { messages, model, temperature, max_tokens } = req.body;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        messages: messages || [],
        temperature: temperature !== undefined ? temperature : 0.4,
        max_tokens: max_tokens || 2048
      })
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// FRONTEND & FALLBACK
// ==========================================

// Serve index.html strictly for GET root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Explicit fallback only for GET navigation requests
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Signal active on port ${PORT}`);
});