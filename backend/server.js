import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// === Storage Config ===
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
const upload = multer({ storage });

// === In-memory document store ===
const documentStore = new Map();

// Enhanced chunking with semantic boundaries
function chunkText(text, chunkSize = 1000, overlap = 300) {
  try {
    if (!text || text.length === 0) return [];

    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);

      if (end < text.length) {
        // Look ahead for good breaking points
        const lookAhead = text.slice(end, Math.min(end + 200, text.length));

        // Priority: paragraph > sentence > word boundary
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
      if (start >= text.length || chunks.length > 1000) break;
    }

    console.log(`Created ${chunks.length} chunks from text`);
    return chunks;
  } catch (error) {
    console.error("Error in chunkText:", error);
    return [];
  }
}

// Robust page extraction from PDF
function extractPages(pdfData) {
  try {
    const pages = [];
    const fullText = pdfData.text;

    if (!fullText || fullText.length === 0) {
      console.warn("No text extracted from PDF");
      return pages;
    }

    // Primary method: Split by form feed character
    const pageTexts = fullText.split("\f");

    if (pageTexts.length > 1) {
      // Successfully split into pages
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
      // Fallback: Create logical pages based on character count
      const avgPageSize = Math.max(
        1500,
        Math.floor(fullText.length / (pdfData.numpages || 1))
      );
      let pageNum = 1;

      for (let i = 0; i < fullText.length; i += avgPageSize) {
        let end = Math.min(i + avgPageSize, fullText.length);

        // Try to break at paragraph
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

// Improved text similarity with stricter scoring
function calculateTextSimilarity(query, text) {
  try {
    if (!query || !text) return 0;

    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();

    // Common stopwords to filter
    const stopwords = new Set([
      "the", "is", "at", "which", "on", "a", "an", "and", "or", "but",
      "in", "with", "to", "for", "of", "as", "by", "from", "be", "are",
      "was", "were", "been", "has", "have", "had", "do", "does", "did",
      "will", "would", "could", "should", "can", "may", "might", "this",
      "that", "these", "those", "it", "its", "what", "who", "where", "when",
    ]);

    const queryWords = queryLower
      .split(/\W+/)
      .filter((w) => w.length > 2 && !stopwords.has(w));

    if (queryWords.length === 0) return 0;

    const textWords = textLower.split(/\W+/);
    let score = 0;

    // 1. Exact phrase matching (highest priority)
    if (textLower.includes(queryLower)) {
      score += 100;
    }

    // 2. Individual word matching with position weighting
    queryWords.forEach((qWord) => {
      // Exact word matches
      const exactMatches = textWords.filter((w) => w === qWord).length;
      score += exactMatches * 15; // Increased weight

      // Partial matches (word contains query word) - reduced weight
      const partialMatches = textWords.filter(
        (w) => w.length > qWord.length && w.includes(qWord)
      ).length;
      score += partialMatches * 2; // Reduced weight

      // Stemming (remove common suffixes)
      const qStem = qWord.replace(/(?:ing|ed|s|es|ly|er|est)$/i, "");
      if (qStem.length > 3) {
        const stemMatches = textWords.filter((w) => {
          const wStem = w.replace(/(?:ing|ed|s|es|ly|er|est)$/i, "");
          return wStem === qStem && w !== qWord;
        }).length;
        score += stemMatches * 5; // Increased weight
      }
    });

    // 3. Multi-word proximity scoring
    if (queryWords.length > 1) {
      for (let i = 0; i < queryWords.length - 1; i++) {
        const word1Pos = textLower.indexOf(queryWords[i]);
        const word2Pos = textLower.indexOf(queryWords[i + 1]);

        if (word1Pos !== -1 && word2Pos !== -1) {
          const distance = Math.abs(word2Pos - word1Pos);

          // Close proximity bonus (within 50 characters)
          if (distance < 50) {
            score += 20 * (1 - distance / 50); // Increased bonus
          } else if (distance < 200) {
            score += 8 * (1 - distance / 200); // Increased bonus
          }
        }
      }
    }

    // 4. Coverage score - how many query words appear
    const matchedWords = queryWords.filter((qw) =>
      textWords.some((tw) => tw === qw) // Only exact matches
    ).length;
    const coverageRatio = matchedWords / queryWords.length;
    score += coverageRatio * 30; // Increased weight

    // 5. Density bonus - concentration of matches
    const matchDensity = matchedWords / Math.max(textWords.length, 1);
    score += matchDensity * 150; // Increased weight

    // Normalize by text length (sqrt to reduce impact)
    const normalizedScore = score / Math.sqrt(textWords.length);

    return normalizedScore;
  } catch (error) {
    console.error("Error in calculateTextSimilarity:", error);
    return 0;
  }
}

// Find most relevant chunks with stricter thresholds
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

    // Calculate similarity for all chunks
    const chunksWithScores = docData.chunks.map((chunk) => ({
      ...chunk,
      similarity: calculateTextSimilarity(query, chunk.content),
    }));

    // Sort by similarity
    chunksWithScores.sort((a, b) => b.similarity - a.similarity);

    // Stricter dynamic threshold
    const topScore = chunksWithScores[0]?.similarity || 0;
    const dynamicThreshold = Math.max(1.2, topScore * 0.6); // Increased thresholds

    const relevant = chunksWithScores
      .filter((chunk) => chunk.similarity >= dynamicThreshold)
      .slice(0, topK);

    // Check if average similarity is too low
    if (relevant.length > 0) {
      const avgSimilarity = relevant.reduce((sum, chunk) => sum + chunk.similarity, 0) / relevant.length;
      
      if (avgSimilarity < 1.0) { // Increased threshold
        console.log(`Average similarity too low: ${avgSimilarity.toFixed(2)}`);
        return [];
      }
    }

    console.log(
      `✓ Found ${
        relevant.length
      } relevant chunks (threshold: ${dynamicThreshold.toFixed(2)})`
    );
    relevant.slice(0, 5).forEach((r, i) => {
      console.log(
        `  ${i + 1}. Page ${r.pageNumber}, Score: ${r.similarity.toFixed(2)}`
      );
      console.log(`     Preview: ${r.content.substring(0, 100)}...`);
    });

    return relevant;
  } catch (error) {
    console.error("Error in findRelevantChunks:", error);
    return [];
  }
}

// Enhanced Ollama call with better parameters
async function callLocalModel(prompt, maxTokens = 800) {
  try {
    console.log("📤 Sending to Ollama...");

    const res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma3:1b",
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.2, // Lower temperature for more factual responses
          top_p: 0.8,
          top_k: 30,
          repeat_penalty: 1.2,
          num_predict: maxTokens,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama error: ${res.status}`);
    }

    const data = await res.json();
    console.log("📥 Received response from Ollama");
    return data.response || "Unable to generate response.";
  } catch (error) {
    console.error("Ollama error:", error);
    if (error.code === "ECONNREFUSED") {
      throw new Error("Ollama is not running. Start it with: ollama serve");
    }
    throw error;
  }
}

// === Upload Route ===
app.post("/api/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No PDF uploaded" });
    }

    console.log(`\n📄 Processing: ${req.file.originalname}`);

    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);

    if (!pdfData.text || pdfData.text.trim().length < 50) {
      return res.status(400).json({
        success: false,
        error: "PDF is empty or unreadable",
      });
    }

    console.log(
      `📊 Extracted: ${pdfData.text.length} chars, ${pdfData.numpages} pages`
    );

    const pages = extractPages(pdfData);

    // Create chunks from each page with page tracking
    const chunks = [];
    pages.forEach((page) => {
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
    });

    console.log(`✅ Stored: ${pages.length} pages, ${chunks.length} chunks\n`);

    res.json({
      success: true,
      documentId,
      pdfUrl: `/uploads/${req.file.filename}`,
      totalPages: pages.length,
      totalChunks: chunks.length,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      success: false,
      error: "Upload failed: " + error.message,
    });
  }
});

// === Enhanced Chat Route ===
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

    // Find relevant chunks with stricter thresholds
    const relevant = await findRelevantChunks(message, documentId, 10);

    // If no relevant chunks found, return immediately
    if (relevant.length === 0) {
      console.log("❌ No relevant information found in document");
      return res.json({
        success: true,
        response: "I couldn't find relevant information in the document to answer your question. Please try rephrasing or asking about different topics covered in the document.",
        citations: [],
      });
    }

    // Build rich context with page references
    const context = relevant
      .map((chunk, idx) => {
        const preview =
          chunk.content.length > 800
            ? chunk.content.substring(0, 800) + "..."
            : chunk.content;
        return `[Source ${idx + 1} | Page ${chunk.pageNumber}]\n${preview}`;
      })
      .join("\n\n---\n\n");

    // Enhanced prompt with strict instructions
    const prompt = `You are an expert document analyst. Your task is to provide detailed, accurate answers based solely on the document excerpts provided below.

DOCUMENT EXCERPTS:
 ${context}

USER QUESTION: ${message}

CRITICAL INSTRUCTIONS:
1. Provide a COMPREHENSIVE answer using ONLY information from the excerpts above
2. Be detailed and thorough - aim for 3-5 sentences minimum when information is available
3. Synthesize information from multiple sources when relevant
4. If specific page numbers are mentioned in brackets, you can reference them (e.g., "According to Page 3...")
5. If the provided excerpts do not contain information to answer the question, respond ONLY with "I couldn't find relevant information in the document to answer your question. Please try rephrasing or asking about different topics covered in the document." Do not attempt to guess or invent an answer.
6. Structure your answer clearly with proper paragraphs if needed
7. Do NOT invent, assume, or add any information not present in the excerpts
8. If the question asks for a list or multiple items, provide complete details for each

DETAILED ANSWER:`;

    const response = await callLocalModel(prompt, 800);

    // Check if response indicates no information was found
    const noInfoPhrases = [
      "I couldn't find relevant information",
      "I don't have information",
      "The document does not contain",
      "No information available",
      "I'm unable to answer",
      "The document doesn't mention",
      "There is no information"
    ];

    const hasNoInfo = noInfoPhrases.some(phrase => 
      response.toLowerCase().includes(phrase.toLowerCase())
    );

    // If model indicates no information or we have no relevant chunks, return standard response
    if (hasNoInfo || relevant.length === 0) {
      return res.json({
        success: true,
        response: "I couldn't find relevant information in the document to answer your question. Please try rephrasing or asking about different topics covered in the document.",
        citations: [],
      });
    }

    // Extract unique page citations
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
      },
    });
  } catch (error) {
    console.error("Chat error:", error);

    let errorMessage = "Failed to process question";
    if (error.message.includes("Ollama")) {
      errorMessage =
        "AI service unavailable. Ensure Ollama is running (ollama serve)";
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// === Health Check ===
app.get("/api/health", async (req, res) => {
  try {
    const ollamaRes = await fetch("http://localhost:11434/api/tags", {
      method: "GET",
    });

    res.json({
      success: true,
      backend: "running",
      ollama: ollamaRes.ok ? "connected" : "disconnected",
      documents: documentStore.size,
    });
  } catch (error) {
    res.json({
      success: true,
      backend: "running",
      ollama: "disconnected",
      documents: documentStore.size,
    });
  }
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
    samplePages: docData.pages.slice(0, 3).map((p) => ({
      page: p.pageNumber,
      preview: p.content.substring(0, 150) + "...",
    })),
  });
});

app.listen(PORT, () => {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`🚀 PDF RAG Server Started`);
  console.log(`${"=".repeat(50)}`);
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`💚 Health: http://localhost:${PORT}/api/health`);
  console.log(`🤖 Ollama: http://localhost:11434`);
  console.log(`${"=".repeat(50)}\n`);
});