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
// ORGANIC DOM SCRAPER & TELEMETRY ENGINE
// ==========================================

const handleFetchUrl = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    let { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'Target URL is required.' });
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 SignalSEO/2.6',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    const loadTimeMs = Date.now() - startTime;
    const html = await fetchResponse.text();

    // Clean plain text extraction for AI evaluation grounding
    const strippedText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return res.json({
      success: true,
      url,
      status: fetchResponse.status,
      statusCode: fetchResponse.status,
      loadTime: loadTimeMs,
      loadTimeMs,
      byteSize: html.length,
      html: html,
      content: html,
      rawHtml: html,
      plainTextExcerpt: strippedText.slice(0, 3000), // Grounding payload
      headers: {
        contentType: fetchResponse.headers.get('content-type') || 'text/html',
        server: fetchResponse.headers.get('server') || 'Cloudflare / Edge',
        cacheControl: fetchResponse.headers.get('cache-control') || 'none'
      }
    });
  } catch (err) {
    console.error('Fetch URL error:', err);
    return res.status(500).json({
      success: false,
      error: `Live fetch failed: ${err.message}`
    });
  }
};

app.post('/api/fetch-url', handleFetchUrl);
app.post('/fetch-url', handleFetchUrl);
app.post('/api/audit', handleFetchUrl);

// ==========================================
// RESILIENT AI PROXY (/api/ai)
// ==========================================

let availableModels = [];
let lastModelsFetch = 0;

async function getAvailableGroqModels(apiKey) {
  const oneHour = 60 * 60 * 1000;
  if (availableModels.length > 0 && (Date.now() - lastModelsFetch < oneHour)) {
    return availableModels;
  }

  try {
    const listRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const listData = await listRes.json();

    if (listData && Array.isArray(listData.data)) {
      const valid = listData.data
        .map(m => m.id)
        .filter(id => !id.includes('whisper') && !id.includes('guard') && !id.includes('vision'));

      // Prioritize high-throughput models (Llama, Gemma) over low-quota ones
      valid.sort((a, b) => {
        const getScore = (id) => {
          if (id.includes('llama')) return 3;
          if (id.includes('gemma') || id.includes('mixtral')) return 2;
          if (id.includes('qwen')) return 0;
          return 1;
        };
        return getScore(b) - getScore(a);
      });

      if (valid.length > 0) {
        availableModels = valid;
        lastModelsFetch = Date.now();
        return availableModels;
      }
    }
  } catch (err) {
    console.warn('Could not query Groq models:', err.message);
  }

  return ['llama-3.3-70b-specdec', 'llama3-70b-8192', 'llama3-8b-8192', 'gemma2-9b-it'];
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

    const modelsToTry = await getAvailableGroqModels(apiKey);
    const wantsJson = prompt.toLowerCase().includes('json');
    let lastError = 'No models responded successfully';

    for (const model of modelsToTry.slice(0, 4)) {
      try {
        const requestBody = {
          model: model,
          messages: [
            {
              role: 'system',
              content: wantsJson
                ? 'You are an organic, deterministic SEO diagnostic engine. Base your evaluation strictly on the exact page content and DOM facts provided. Output a valid, parseable JSON object ONLY. Never include markdown code fences (```json or ```), explanations, or preamble.'
                : 'You are a senior SEO strategist. Provide direct, factual, data-driven advice.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1, // Low temperature eliminates hallucinations and delivers consistent, organic scoring
          max_tokens: 700
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

        if (aiResponse.ok && data.choices?.[0]?.message?.content) {
          let aiContent = data.choices[0].message.content.trim();
          aiContent = aiContent.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

          return res.json({
            success: true,
            response: aiContent
          });
        }

        lastError = data.error?.message || `Model ${model} failed`;
      } catch (err) {
        lastError = err.message;
      }
    }

    return res.status(500).json({
      success: false,
      error: `AI provider rate-limit or quota error: ${lastError}`
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
// 100% ORGANIC LIVE GOOGLE SERP DATA
// ==========================================

// 1. Real Google SERP Rank Tracker
app.post('/api/rank-check', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { domain, query, gl = 'us' } = req.body;
    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'SERPER_API_KEY is not configured in Railway Variables.' });
    }
    if (!domain || !query) {
      return res.status(400).json({ success: false, error: 'Domain and query are required.' });
    }

    const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, gl: gl, num: 50 })
    });

    const data = await response.json();
    const organicResults = data.organic || [];

    let rank = null;
    let targetResult = null;

    for (let i = 0; i < organicResults.length; i++) {
      if (organicResults[i].link.toLowerCase().includes(cleanDomain)) {
        rank = i + 1;
        targetResult = organicResults[i];
        break;
      }
    }

    return res.json({
      success: true,
      query,
      domain: cleanDomain,
      rank: rank || '50+ (Not in top 50)',
      targetResult,
      topCompetitor: organicResults[0] || null,
      paaQuestions: data.peopleAlsoAsk || [],
      totalSearchHits: data.searchInformation?.totalResults || 0
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: `Live SERP fetch failed: ${err.message}` });
  }
});

// 2. Real Google Keyword Autocomplete & People Also Ask
app.post('/api/keyword-data', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { query } = req.body;
    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'SERPER_API_KEY is not configured in Railway Variables.' });
    }
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query is required.' });
    }

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, gl: 'us' })
    });

    const data = await response.json();

    return res.json({
      success: true,
      query,
      organicTop10: (data.organic || []).slice(0, 10).map(r => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet,
        position: r.position
      })),
      peopleAlsoAsk: data.peopleAlsoAsk || [],
      relatedSearches: data.relatedSearches || []
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: `Live keyword fetch failed: ${err.message}` });
  }
});

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