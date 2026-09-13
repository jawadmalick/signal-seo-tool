require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Body parser & CORS middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static assets folder
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
// SCRAPER / DOM FETCHER PROXY
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
    console.error('Fetch URL error:', err);
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
// DYNAMIC AI EVALUATION PROXY (/api/ai)
// ==========================================

let cachedActiveModel = null;
let lastModelFetchTime = 0;

async function getLiveGroqModel(apiKey) {
  // Cache the working model for 1 hour to avoid extra network lookups
  const oneHour = 60 * 60 * 1000;
  if (cachedActiveModel && (Date.now() - lastModelFetchTime < oneHour)) {
    return cachedActiveModel;
  }

  try {
    const listRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const listData = await listRes.json();

    if (listData && Array.isArray(listData.data) && listData.data.length > 0) {
      // Filter out audio/whisper/guard models, prioritize text chat models
      const textModels = listData.data
        .map(m => m.id)
        .filter(id => !id.includes('whisper') && !id.includes('guard') && !id.includes('vision') && m_active(id));

      if (textModels.length > 0) {
        cachedActiveModel = textModels[0];
        lastModelFetchTime = Date.now();
        console.log(`Using live active Groq model: ${cachedActiveModel}`);
        return cachedActiveModel;
      }
    }
  } catch (err) {
    console.warn('Could not auto-fetch live models list:', err.message);
  }

  return 'llama-3.3-70b-versatile';
}

function m_active(id) {
  return id.startsWith('llama') || id.startsWith('mixtral') || id.startsWith('gemma') || id.startsWith('deepseek') || id.startsWith('qwen');
}

const handleAi = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const apiKey = process.env.GROQ_API_KEY || process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: 'GROQ_API_KEY is not configured in Railway Variables.'
      });
    }

    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required.' });
    }

    const activeModel = await getLiveGroqModel(apiKey);

    const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: activeModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2048
      })
    });

    const data = await aiResponse.json();

    if (!aiResponse.ok) {
      // Clear cache if the model failed
      cachedActiveModel = null;
      return res.status(aiResponse.status).json({
        success: false,
        error: data.error?.message || 'AI provider request failed'
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
      error: `AI processing error: ${err.message}`
    });
  }
};

app.post('/api/ai', handleAi);
app.post('/ai', handleAi);
app.post('/api/groq', handleAi);

// ==========================================
// SPA NAVIGATION FALLBACK (GET ONLY)
// ==========================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Signal SEO backend online on port ${PORT}`);
});