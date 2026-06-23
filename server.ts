import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase request size limit for PDF uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Server API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Endpoint to Parse Petty Cash PDF / Image
app.post("/api/parse-petty-cash", async (req, res) => {
  try {
    const { fileBase64, fileName, mimeType } = req.body;

    if (!fileBase64) {
      return res.status(400).json({ error: "No file content provided" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: "GEMINI_API_KEY is not configured on the server. Please check your system secrets." 
      });
    }

    const defaultMime = mimeType || "application/pdf";
    
    const inlinePart = {
      inlineData: {
        mimeType: defaultMime,
        data: fileBase64,
      },
    };

    const textPart = {
      text: `Analyze this field worker petty cash document (PDF/Image) and extract all transaction lines. 
Strictly structure your response in Indonesian/English as specified below.
Provide a clean summary of cash inflows (In/Kredit/Penerimaan) and outflows (Out/Debet/Pengeluaran).
Ensure you capture:
1. Transaction Date (format YYYY-MM-DD or keep original if clear)
2. Description of the transaction (keterangan)
3. Category (e.g., Material, Transport, Konsumsi, Tools, Lain-lain)
4. Amount (numeric value only)
5. Worker Name (Nama Pekerja/Karyawan if mentioned, otherwise leave blank or empty string)
6. Transaction Type: 'EXPENSE' or 'INCOME'

Also find the overall document summary if stated, such as:
- Total cash received (Total Penerimaan)
- Total cash spent (Total Pengeluaran)
- Worker/Field staff name
- Period / Month of report

Return a strict JSON response conforming exactly to this structure:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "Bought cement",
      "category": "Material",
      "amount": 250000,
      "worker": "Budiono",
      "type": "EXPENSE"
    }
  ],
  "summary": {
    "totalIncome": 1000000,
    "totalExpense": 250000,
    "remainingBalance": 750000,
    "workerName": "Budiono",
    "reportMonth": "Juni 2026"
  }
}`,
    };

    console.log("Analyzing file: size =" + fileBase64.length + " bytes, type =" + defaultMime);

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [inlinePart, textPart],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  description: { type: Type.STRING },
                  category: { type: Type.STRING },
                  amount: { type: Type.INTEGER },
                  worker: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ["EXPENSE", "INCOME"] },
                },
                required: ["date", "description", "category", "amount", "type"],
              },
            },
            summary: {
              type: Type.OBJECT,
              properties: {
                totalIncome: { type: Type.INTEGER },
                totalExpense: { type: Type.INTEGER },
                remainingBalance: { type: Type.INTEGER },
                workerName: { type: Type.STRING },
                reportMonth: { type: Type.STRING },
              },
              required: ["totalIncome", "totalExpense", "remainingBalance"],
            },
          },
          required: ["transactions", "summary"],
        },
      },
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No response received from Gemini engine");
    }

    const parsedData = JSON.parse(resultText);
    res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Parsing error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze document" });
  }
});

// Vite Middleware for Development vs Production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
