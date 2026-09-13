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
// DYNAMIC AI PROXY (/api/ai) WITH STRICT JSON ENFORCEMENT
// ==========================================

let cachedActiveModel = null;
let lastModelFetchTime = 0;

async function getLiveGroqModel(apiKey) {
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
      // Prioritize active chat models (Llama and Mistral first, then Qwen)
      const validModels = listData.data
        .map(m => m.id)
        .filter(id => !id.includes('whisper') && !id.includes('guard') && !id.includes('vision'));

      const preferred = validModels.find(id => id.includes('llama')) || validModels[0];

      if (preferred) {
        cachedActiveModel = preferred;
        lastModelFetchTime = Date.now();
        console.log(`Groq model selected: ${cachedActiveModel}`);
        return cachedActiveModel;
      }
    }
  } catch (err) {
    console.warn('Could not auto-fetch live models list:', err.message);
  }

  return 'llama3-8b-8192';
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
    const wantsJson = prompt.toLowerCase().includes('json');

    const requestBody = {
      model: activeModel,
      messages: [
        {
          role: 'system',
          content: wantsJson
            ? 'You are an SEO analysis engine. You MUST respond with a valid, parseable JSON object ONLY. Never include markdown code fences (```json or ```), explanations, or surrounding text.'
            : 'You are an SEO analysis engine. Provide direct, factual responses.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 950 // Stays below Groq's 1000 OTPM ceiling
    };

    if (wantsJson) {
      requestBody.response_format = { type: 'json_object' };
    }

    const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await aiResponse.json();

    if (!aiResponse.ok) {
      cachedActiveModel = null;
      return res.status(aiResponse.status).json({
        success: false,
        error: data.error?.message || 'AI provider request failed'
      });
    }

    let aiContent = data.choices?.[0]?.message?.content || '{}';

    // Strip any accidental markdown formatting
    aiContent = aiContent.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

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