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

// Static assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ==========================================
// SEO & BOT CRAWLER ROUTES
// ==========================================

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'robots.txt'), (err) => {
    if (err) {
      res.send("User-agent: *\nAllow: /\nSitemap: https://signal-seo-tool.up.railway.app/sitemap.xml");
    }
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
// LIVE DOM FETCHER / CRAWLER PROXY
// ==========================================

const handleFetchUrl = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    let { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required.' });
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const startTime = Date.now();
    const fetchResponse = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    const loadTimeMs = Date.now() - startTime;
    const html = await fetchResponse.text();

    return res.json({
      success: true,
      url,
      status: fetchResponse.status,
      statusCode: fetchResponse.status,
      loadTime: loadTimeMs,
      loadTimeMs,
      html: html,
      content: html,
      rawHtml: html
    });
  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch target URL: ${err.message}`
    });
  }
};

app.post('/api/fetch-url', handleFetchUrl);
app.post('/fetch-url', handleFetchUrl);
app.post('/api/audit', handleFetchUrl);

// ==========================================
// AI EVALUATION ENDPOINT (/api/ai)
// ==========================================

app.post('/api/ai', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GROQ_API_KEY environment variable is not configured on Railway.'
      });
    }

    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required.' });
    }

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2048
      })
    });

    const data = await groqResponse.json();

    if (!groqResponse.ok) {
      console.error('Groq API Error:', data);
      return res.status(groqResponse.status).json({
        success: false,
        error: data.error?.message || 'Upstream AI model request failed.'
      });
    }

    const aiContent = data.choices?.[0]?.message?.content || '';

    return res.json({
      success: true,
      response: aiContent
    });
  } catch (err) {
    console.error('AI Proxy Error:', err);
    return res.status(500).json({
      success: false,
      error: `AI processing failure: ${err.message}`
    });
  }
});

// ==========================================
// FRONTEND ROUTING & FALLBACK
// ==========================================

// Explicit GET routes for SPA navigation
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Server listener
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Signal SEO backend running on port ${PORT}`);
});