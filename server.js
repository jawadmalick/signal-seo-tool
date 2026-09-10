require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers (CSP disabled so inline scripts in index.html work)
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname)));

// Limit each IP to 30 requests per 15 minutes to protect your API limits
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    error: "Rate limit reached. Please wait a few minutes before trying again."
  }
});

app.get("/api/test", (req, res) => {
  res.json({ success: true, message: "Signal SEO backend is running!" });
});

app.post("/api/ai", aiLimiter, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: "Prompt is required" });
    }

    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "AI_API_KEY is missing. Check your .env file."
      });
    }

    // Connects to Groq using the developer-tier supported model
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI Provider error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "";

    res.json({ success: true, response: reply });
  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Express 5 fallback route to serve index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});