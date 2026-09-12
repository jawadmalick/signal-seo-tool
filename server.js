require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static assets from project root
app.use(express.static(__dirname));

// ==========================================
// SEO & BOT CRAWLER ROUTES
// ==========================================

// Explicit robots.txt route
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'robots.txt'), (err) => {
    if (err) {
      res.send("User-agent: *\nAllow: /\nSitemap: https://signal-seo-tool.up.railway.app/sitemap.xml");
    }
  });
});

// Explicit sitemap.xml route
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
// API ROUTES
// ==========================================

// Groq AI Integration Endpoint
app.post('/api/groq', async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
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
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Groq API error' });
    }

    res.json(data);
  } catch (error) {
    console.error('Groq Proxy Error:', error);
    res.status(500).json({ error: 'Internal server error processing AI request.' });
  }
});

// Live Web Scraper / Technical Audit Endpoint
app.post('/api/audit', async (req, res) => {
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
    const statusCode = fetchResponse.status;

    // Extract core on-page elements
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
                          html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
    const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : '';

    const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i);
    const canonical = canonicalMatch ? canonicalMatch[1].trim() : '';

    const h1Matches = [...html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)].map(m => m[1].trim());
    const h2Matches = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi)].map(m => m[1].trim());

    const hasSchema = /<script[^>]*type=["']application\/ld\+json["'][^>]*>/i.test(html);
    const hasOpenGraph = /<meta[^>]*property=["']og:/i.test(html);
    const hasTwitterCard = /<meta[^>]*name=["']twitter:/i.test(html);

    // Clean text for word count analysis
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;

    res.json({
      url,
      statusCode,
      loadTimeMs,
      title,
      metaDescription,
      canonical,
      h1: h1Matches,
      h2Count: h2Matches.length,
      wordCount,
      hasSchema,
      hasOpenGraph,
      hasTwitterCard,
      rawHtmlPreview: html.substring(0, 3000)
    });
  } catch (error) {
    console.error('Audit Fetch Error:', error);
    res.status(500).json({ error: `Failed to crawl target site: ${error.message}` });
  }
});

// Serve frontend application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Global Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Signal Engine active on port ${PORT}`);
});