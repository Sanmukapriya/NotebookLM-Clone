import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;

// API Configuration - Set your API keys in .env file
const AI_PROVIDER = process.env.AI_PROVIDER || "gemini";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

const documentStore = new Map();

// Enhanced chunking
function chunkText(text, chunkSize = 1000, overlap = 300) {
  try {
    if (!text || text.length === 0) return [];

    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);

      if (end < text.length) {
        const lookAhead = text.slice(end, Math.min(end + 200, text.length));

        const breakPoints = [
          { pattern: /\n\n/, weight: 3 },
          { pattern: /[.!?]\s+/, weight: 2 },
          { pattern: /[,;]\s+/, weight: 1 },
          { pattern: /\s+/, weight: 0.5 },
        ];

        let bestBreak = -1;
        let bestWeight = -1;

        for (const { pattern, weight } of breakPoints) {
          const match = lookAhead.search(pattern);
          if (match !== -1 && match < 150 && weight > bestWeight) {
            bestBreak = match;
            bestWeight = weight;
          }
        }

        if (bestBreak > 0) {
          end += bestBreak;
        }
      }

      const chunk = text.slice(start, end).trim();
      if (chunk.length > 100) {
        chunks.push(chunk);
      }

      start = end - overlap;
      if (start >= text.length || chunks.length > 2000) break;
    }

    return chunks;
  } catch (error) {
    console.error("Error in chunkText:", error);
    return [];
  }
}

// Extract pages
function extractPages(pdfData) {
  try {
    const pages = [];
    const fullText = pdfData.text;

    if (!fullText || fullText.length === 0) {
      console.warn("No text extracted from PDF");
      return pages;
    }

    const pageTexts = fullText.split("\f");

    if (pageTexts.length > 1) {
      pageTexts.forEach((pageText, idx) => {
        const trimmed = pageText.trim();
        if (trimmed.length > 30) {
          pages.push({
            pageNumber: idx + 1,
            content: trimmed,
          });
        }
      });
      console.log(`Extracted ${pages.length} pages using form feed`);
    } else {
      const avgPageSize = Math.max(
        1500,
        Math.floor(fullText.length / (pdfData.numpages || 1))
      );
      let pageNum = 1;

      for (let i = 0; i < fullText.length; i += avgPageSize) {
        let end = Math.min(i + avgPageSize, fullText.length);

        if (end < fullText.length) {
          const lookAhead = fullText.slice(
            end,
            Math.min(end + 300, fullText.length)
          );
          const paraBreak = lookAhead.indexOf("\n\n");
          if (paraBreak !== -1 && paraBreak < 250) {
            end += paraBreak + 2;
          }
        }

        const pageContent = fullText.slice(i, end).trim();
        if (pageContent.length > 50) {
          pages.push({
            pageNumber: pageNum++,
            content: pageContent,
          });
        }
      }
      console.log(`Created ${pages.length} logical pages`);
    }

    return pages;
  } catch (error) {
    console.error("Error in extractPages:", error);
    return [];
  }
}

// Text similarity
function calculateTextSimilarity(query, text) {
  try {
    if (!query || !text) return 0;

    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    const stopwords = new Set([
      "the",
      "is",
      "at",
      "which",
      "on",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "with",
      "to",
      "for",
      "of",
      "as",
      "by",
      "from",
      "be",
      "are",
      "was",
      "were",
      "been",
      "has",
      "have",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "can",
      "may",
      "might",
      "this",
      "that",
      "these",
      "those",
      "it",
      "its",
      "what",
      "who",
      "where",
      "when",
    ]);

    const queryWords = queryLower
      .split(/\W+/)
      .filter((w) => w.length > 2 && !stopwords.has(w));

    if (queryWords.length === 0) return 0;

    const textWords = textLower.split(/\W+/);
    let score = 0;

    if (textLower.includes(queryLower)) {
      score += 100;
    }

    queryWords.forEach((qWord) => {
      const exactMatches = textWords.filter((w) => w === qWord).length;
      score += exactMatches * 15;

      const partialMatches = textWords.filter(
        (w) => w.length > qWord.length && w.includes(qWord)
      ).length;
      score += partialMatches * 2;

      const qStem = qWord.replace(/(?:ing|ed|s|es|ly|er|est)$/i, "");
      if (qStem.length > 3) {
        const stemMatches = textWords.filter((w) => {
          const wStem = w.replace(/(?:ing|ed|s|es|ly|er|est)$/i, "");
          return wStem === qStem && w !== qWord;
        }).length;
        score += stemMatches * 5;
      }
    });

    if (queryWords.length > 1) {
      for (let i = 0; i < queryWords.length - 1; i++) {
        const word1Pos = textLower.indexOf(queryWords[i]);
        const word2Pos = textLower.indexOf(queryWords[i + 1]);

        if (word1Pos !== -1 && word2Pos !== -1) {
          const distance = Math.abs(word2Pos - word1Pos);

          if (distance < 50) {
            score += 20 * (1 - distance / 50);
          } else if (distance < 200) {
            score += 8 * (1 - distance / 200);
          }
        }
      }
    }

    const matchedWords = queryWords.filter((qw) =>
      textWords.some((tw) => tw === qw)
    ).length;
    const coverageRatio = matchedWords / queryWords.length;
    score += coverageRatio * 30;

    const matchDensity = matchedWords / Math.max(textWords.length, 1);
    score += matchDensity * 150;

    const normalizedScore = score / Math.sqrt(textWords.length);

    return normalizedScore;
  } catch (error) {
    console.error("Error in calculateTextSimilarity:", error);
    return 0;
  }
}

// Find relevant chunks
async function findRelevantChunks(query, documentId, topK = 10) {
  try {
    const docData = documentStore.get(documentId);
    if (!docData || !docData.chunks || docData.chunks.length === 0) {
      console.log("No document or chunks found");
      return [];
    }

    console.log(
      `\n🔍 Searching "${query}" across ${docData.chunks.length} chunks`
    );

    const chunksWithScores = docData.chunks.map((chunk) => ({
      ...chunk,
      similarity: calculateTextSimilarity(query, chunk.content),
    }));

    chunksWithScores.sort((a, b) => b.similarity - a.similarity);

    const topScore = chunksWithScores[0]?.similarity || 0;
    const dynamicThreshold = Math.max(1.2, topScore * 0.6);

    const relevant = chunksWithScores
      .filter((chunk) => chunk.similarity >= dynamicThreshold)
      .slice(0, topK);

    if (relevant.length > 0) {
      const avgSimilarity =
        relevant.reduce((sum, chunk) => sum + chunk.similarity, 0) /
        relevant.length;

      if (avgSimilarity < 1.0) {
        console.log(`Average similarity too low: ${avgSimilarity.toFixed(2)}`);
        return [];
      }
    }

    console.log(
      `✓ Found ${
        relevant.length
      } relevant chunks (threshold: ${dynamicThreshold.toFixed(2)})`
    );

    return relevant;
  } catch (error) {
    console.error("Error in findRelevantChunks:", error);
    return [];
  }
}

// === AI Model Calls ===
// === AI Model Calls ===
async function listAvailableModels() {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${GEMINI_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }

    const data = await response.json();
    console.log("Available models:", data);
    return data.models;
  } catch (error) {
    console.error("Error listing models:", error);
    throw error;
  }
}

// Google Gemini API
async function callGeminiAPI(prompt, maxTokens = 1000) {
  try {
    console.log("📤 Sending to Google Gemini...");

    // Properly await the listAvailableModels function
    const models = await listAvailableModels();
    console.log("Available models:", models);

    // Find a suitable model that supports generateContent
    const supportedModel = models.find(
      (model) =>
        model.supportedGenerationMethods &&
        model.supportedGenerationMethods.includes("generateContent")
    );

    if (!supportedModel) {
      throw new Error("No models found that support generateContent");
    }

    // Extract the model name (remove the "models/" prefix)
    const modelName = supportedModel.name.replace("models/", "");
    console.log(`Using model: ${modelName}`);

    // Use the found model
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: maxTokens,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log("📥 Received response from Gemini");

    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text;
    }

    return "Unable to generate response.";
  } catch (error) {
    console.error("Gemini error:", error);
    throw error;
  }
}

// Groq API
async function callGroqAPI(prompt, maxTokens = 1000) {
  try {
    console.log("📤 Sending to Groq...");

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
          top_p: 0.9,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log("📥 Received response from Groq");

    if (data.choices && data.choices[0]?.message?.content) {
      return data.choices[0].message.content;
    }

    return "Unable to generate response.";
  } catch (error) {
    console.error("Groq error:", error);
    throw error;
  }
}

// Universal AI call function
async function callAIModel(prompt, maxTokens = 1000) {
  switch (AI_PROVIDER.toLowerCase()) {
    case "gemini":
      if (!GEMINI_API_KEY) {
        throw new Error(
          "GEMINI_API_KEY not found. Get it from https://aistudio.google.com/app/apikey"
        );
      }
      return await callGeminiAPI(prompt, maxTokens);

    case "groq":
      if (!GROQ_API_KEY) {
        throw new Error(
          "GROQ_API_KEY not found. Get it from https://console.groq.com"
        );
      }
      return await callGroqAPI(prompt, maxTokens);

    default:
      throw new Error(
        `Unknown AI provider: ${AI_PROVIDER}. Use 'gemini', or 'groq'`
      );
  }
}

// === Upload Route ===
app.post("/api/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No PDF uploaded" });
    }

    console.log(
      `\n📄 Processing: ${req.file.originalname} (${(
        req.file.size /
        1024 /
        1024
      ).toFixed(2)} MB)`
    );

    const pdfBuffer = fs.readFileSync(req.file.path);

    console.log("🔍 Parsing PDF...");
    const pdfData = await pdfParse(pdfBuffer, {
      max: 0,
    });

    if (!pdfData.text || pdfData.text.trim().length < 50) {
      return res.status(400).json({
        success: false,
        error: "PDF is empty or unreadable",
      });
    }

    console.log(
      `📊 Extracted: ${(pdfData.text.length / 1024).toFixed(2)} KB text, ${
        pdfData.numpages
      } pages`
    );

    console.log("📑 Extracting pages...");
    const pages = extractPages(pdfData);

    console.log("✂️ Creating chunks...");
    const chunks = [];
    pages.forEach((page, pageIdx) => {
      if (pageIdx % 50 === 0) {
        console.log(`   Processing page ${pageIdx + 1}/${pages.length}...`);
      }
      const pageChunks = chunkText(page.content, 1000, 300);
      pageChunks.forEach((content, idx) => {
        chunks.push({
          content,
          pageNumber: page.pageNumber,
          chunkIndex: idx,
        });
      });
    });

    const documentId = req.file.filename;
    documentStore.set(documentId, {
      pages,
      chunks,
      originalName: req.file.originalname,
      fullText: pdfData.text,
      numPages: pdfData.numpages,
      uploadedAt: new Date().toISOString(),
    });

    console.log(`✅ Stored: ${pages.length} pages, ${chunks.length} chunks\n`);

    res.json({
      success: true,
      documentId,
      pdfUrl: `/uploads/${req.file.filename}`,
      totalPages: pages.length,
      totalChunks: chunks.length,
      fileSize: req.file.size,
      aiProvider: AI_PROVIDER,
    });
  } catch (error) {
    console.error("Upload error:", error);

    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error("Cleanup error:", cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      error: "Upload failed: " + error.message,
    });
  }
});

// === Chat Route ===
app.post("/api/chat", async (req, res) => {
  try {
    const { message, documentId } = req.body;

    if (!message || !documentId) {
      return res.status(400).json({
        success: false,
        error: "Message and documentId required",
      });
    }

    const docData = documentStore.get(documentId);
    if (!docData) {
      return res.status(404).json({
        success: false,
        error: "Document not found. Please re-upload.",
      });
    }

    console.log(`\n💬 Question: "${message}"`);

    const relevant = await findRelevantChunks(message, documentId, 10);

    if (relevant.length === 0) {
      console.log("❌ No relevant information found in document");
      return res.json({
        success: true,
        response:
          "I couldn't find relevant information in the document to answer your question. Please try rephrasing or asking about different topics covered in the document.",
        citations: [],
      });
    }

    const context = relevant
      .map((chunk, idx) => {
        const preview =
          chunk.content.length > 800
            ? chunk.content.substring(0, 800) + "..."
            : chunk.content;
        return `[Source ${idx + 1} | Page ${chunk.pageNumber}]\n${preview}`;
      })
      .join("\n\n---\n\n");

    const prompt = `You are an expert document analyst. Your task is to provide detailed, accurate answers based solely on the document excerpts provided below.

DOCUMENT EXCERPTS:
${context}

USER QUESTION: ${message}

CRITICAL INSTRUCTIONS:
1. Provide a COMPREHENSIVE answer using ONLY information from the excerpts above
2. Be detailed and thorough - aim for 3-5 sentences minimum when information is available
3. Synthesize information from multiple sources when relevant
4. If specific page numbers are mentioned in brackets, you can reference them (e.g., "According to Page 3...")
5. If the provided excerpts do not contain information to answer the question, respond ONLY with "I couldn't find relevant information in the document to answer your question."
6. Structure your answer clearly with proper paragraphs if needed
7. Do NOT invent, assume, or add any information not present in the excerpts
8. If the question asks for a list or multiple items, provide complete details for each

DETAILED ANSWER:`;

    const response = await callAIModel(prompt, 1000);

    const noInfoPhrases = [
      "I couldn't find relevant information",
      "I don't have information",
      "The document does not contain",
      "No information available",
      "I'm unable to answer",
      "The document doesn't mention",
      "There is no information",
    ];

    const hasNoInfo = noInfoPhrases.some((phrase) =>
      response.toLowerCase().includes(phrase.toLowerCase())
    );

    if (hasNoInfo) {
      return res.json({
        success: true,
        response:
          "I couldn't find relevant information in the document to answer your question. Please try rephrasing or asking about different topics covered in the document.",
        citations: [],
      });
    }

    const significantChunks = relevant.filter(
      (chunk) => chunk.similarity > 1.5
    );
    const citations = [
      ...new Set(
        (significantChunks.length > 0
          ? significantChunks
          : relevant.slice(0, 5)
        ).map((r) => r.pageNumber)
      ),
    ].sort((a, b) => a - b);

    console.log(
      `✅ Response generated with ${
        citations.length
      } citations: [${citations.join(", ")}]\n`
    );

    res.json({
      success: true,
      response: response.trim(),
      citations,
      metadata: {
        chunksAnalyzed: docData.chunks.length,
        relevantChunks: relevant.length,
        topScore: relevant[0]?.similarity.toFixed(2),
        aiProvider: AI_PROVIDER,
      },
    });
  } catch (error) {
    console.error("Chat error:", error);

    let errorMessage = "Failed to process question: " + error.message;

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// === Health Check ===
app.get("/api/health", async (req, res) => {
  let aiStatus = "unknown";

  try {
    if (AI_PROVIDER === "gemini") {
      aiStatus = GEMINI_API_KEY ? "configured" : "missing API key";
    } else if (AI_PROVIDER === "groq") {
      aiStatus = GROQ_API_KEY ? "configured" : "missing API key";
    }
  } catch (error) {
    aiStatus = "error";
  }

  res.json({
    success: true,
    backend: "running",
    aiProvider: AI_PROVIDER,
    aiStatus: aiStatus,
    documents: documentStore.size,
  });
});

// === Document Info Route ===
app.get("/api/document/:documentId/info", (req, res) => {
  const docData = documentStore.get(req.params.documentId);

  if (!docData) {
    return res
      .status(404)
      .json({ success: false, error: "Document not found" });
  }

  res.json({
    success: true,
    name: docData.originalName,
    pages: docData.pages.length,
    chunks: docData.chunks.length,
    textLength: docData.fullText?.length || 0,
    uploadedAt: docData.uploadedAt,
    samplePages: docData.pages.slice(0, 3).map((p) => ({
      page: p.pageNumber,
      preview: p.content.substring(0, 150) + "...",
    })),
  });
});

// === Favicon Route ===
app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🚀 PDF RAG Server Started`);
  console.log(`${"=".repeat(60)}`);
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`💚 Health: http://localhost:${PORT}/api/health`);
  console.log(`🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}`);

  if (AI_PROVIDER === "gemini") {
    console.log(
      `🔑 Gemini API: ${GEMINI_API_KEY ? "✓ Configured" : "✗ Missing"}`
    );
  } else if (AI_PROVIDER === "groq") {
    console.log(`🔑 Groq API: ${GROQ_API_KEY ? "✓ Configured" : "✗ Missing"}`);
  }

  console.log(`📁 Max file size: 100MB`);
  console.log(`${"=".repeat(60)}\n`);
});
