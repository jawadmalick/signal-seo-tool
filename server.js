import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html from root if not in public/
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint: Scrape live site HTML directly from URL
app.post('/api/fetch-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const targetUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SignalSEO/2.0'
      },
      redirect: 'follow',
      timeout: 15000
    });

    const html = await response.text();
    res.json({
      success: true,
      status: response.status,
      finalUrl: response.url,
      html: html.slice(0, 300000) // 300kb cap for safety
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Could not fetch URL: ' + error.message });
  }
});

// Endpoint: Groq AI proxy
app.post('/api/ai', async (req, res) => {
  try {
    const { prompt } = req.body;
    const apiKey = process.env.AI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'AI_API_KEY is not set in Railway environment variables.' });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are an elite SEO, AEO, and GEO technical auditor and strategist. Return strictly formatted, deeply detailed JSON or requested markdown without preamble.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 3500
      })
    });

    const data = await response.json();
    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    res.json({
      success: true,
      response: data.choices[0].message.content
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process AI request: ' + error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Signal SEO Tool engine listening on http://0.0.0.0:${PORT}`);
});