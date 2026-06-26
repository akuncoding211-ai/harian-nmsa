import express from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Increase request size limit for PDF uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Path for state storage
const DATA_FILE = path.join(process.cwd(), "data-store.json");

// Helper to generate deterministic daily pin
function getAutomaticDailyPin(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;
  
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const pin = Math.abs(hash % 9000) + 1000; // 4-digit PIN between 1000 and 9999
  return String(pin);
}

// Helper to read state safely
function readState() {
  const autoPin = getAutomaticDailyPin();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed.attendancePin) {
        parsed.attendancePin = autoPin;
      }
      if (!parsed.signatures) {
        parsed.signatures = {};
      }
      return parsed;
    }
  } catch (error) {
    console.error("Error reading data-store.json:", error);
  }
  return {
    workers: [],
    attendanceRecords: [],
    weeklyReports: [],
    pettyCashReports: [],
    attendancePin: autoPin,
    signatures: {}
  };
}

// Helper to write state safely
function writeState(data: any) {
  try {
    if (!data.attendancePin) {
      data.attendancePin = getAutomaticDailyPin();
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing data-store.json:", error);
  }
}

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

// GET Shared State (Workers, attendance records, reports)
app.get("/api/shared-state", (req, res) => {
  res.json(readState());
});

// POST Shared State (Save data from Admin dashboard)
app.post("/api/shared-state", (req, res) => {
  try {
    const { workers, attendanceRecords, weeklyReports, pettyCashReports, attendancePin, signatures } = req.body;
    const currentState = readState();

    const updatedState = {
      workers: workers !== undefined ? workers : currentState.workers,
      attendanceRecords: attendanceRecords !== undefined ? attendanceRecords : currentState.attendanceRecords,
      weeklyReports: weeklyReports !== undefined ? weeklyReports : currentState.weeklyReports,
      pettyCashReports: pettyCashReports !== undefined ? pettyCashReports : currentState.pettyCashReports,
      attendancePin: attendancePin !== undefined ? attendancePin : currentState.attendancePin,
      signatures: signatures !== undefined ? signatures : currentState.signatures,
    };

    writeState(updatedState);
    res.json({ success: true, message: "State synchronized successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to synchronize state" });
  }
});

// Geolocation Constants & Calculations
const OFFICE_LAT = -6.244342;
const OFFICE_LON = 106.843073;
const MAX_DISTANCE_METERS = 150;

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

// POST Self Attendance (Used by workers via WhatsApp links)
app.post("/api/self-attend", (req, res) => {
  try {
    const { workerId, date, pin, latitude, longitude, signature } = req.body;
    if (!workerId || !date) {
      return res.status(400).json({ error: "ID pekerja dan tanggal wajib diisi." });
    }

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "Verifikasi lokasi GPS wajib diaktifkan untuk melakukan presensi mandiri." });
    }

    const distance = calculateDistance(latitude, longitude, OFFICE_LAT, OFFICE_LON);
    if (distance > MAX_DISTANCE_METERS) {
      return res.status(403).json({ 
        error: `Gagal absen: Lokasi Anda terlalu jauh (~${Math.round(distance)} meter) dari kantor. Maksimal jarak yang diperbolehkan adalah ${MAX_DISTANCE_METERS} meter.` 
      });
    }

    const state = readState();
    const serverPin = state.attendancePin || "1234";
    if (!pin) {
      return res.status(400).json({ error: "PIN presensi wajib dimasukkan." });
    }
    if (pin !== serverPin) {
      return res.status(403).json({ error: "PIN presensi salah. Tanyakan PIN harian yang benar pada Mandor lapangan." });
    }

    const workers = state.workers || [];
    const records = state.attendanceRecords || [];

    const worker = workers.find((w: any) => w.id === workerId && w.isActive);
    if (!worker) {
      return res.status(404).json({ error: "Pekerja tidak ditemukan atau status tidak aktif." });
    }

    // Attempt to find a record for this worker that already covers this date
    let recordUpdated = false;
    for (const r of records) {
      if (r.workerId === workerId && r.attendance && r.attendance[date] !== undefined) {
        r.attendance[date] = true;
        recordUpdated = true;
        break;
      }
    }

    // If no existing record covers the date, create/append one
    if (!recordUpdated) {
      const workerRecord = records.find((r: any) => r.workerId === workerId);
      if (workerRecord) {
        if (!workerRecord.attendance) {
          workerRecord.attendance = {};
        }
        workerRecord.attendance[date] = true;
      } else {
        records.push({
          workerId,
          attendance: { [date]: true },
          dailyAllowance: 25000 // default allowance
        });
      }
    }

    const signatures = state.signatures || {};
    if (signature) {
      signatures[workerId] = signature;
    }

    writeState({
      ...state,
      attendanceRecords: records,
      signatures
    });

    res.json({ 
      success: true, 
      message: `Presensi berhasil tercatat! Terima kasih ${worker.name}.`,
      workerName: worker.name
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gagal melakukan absen mandiri" });
  }
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
The document's file name is: "${fileName}".
Strictly structure your response in Indonesian/English as specified below.
Provide a clean summary of cash inflows (In/Kredit/Penerimaan) and outflows (Out/Debet/Pengeluaran).
Ensure you capture:
1. Transaction Date (format YYYY-MM-DD or keep original if clear)
2. Description of the transaction (keterangan)
3. Category (e.g., Material, Transport, Konsumsi, Tools, Lain-lain)
4. Amount (numeric value only)
5. Worker Name (Nama Pekerja/Karyawan. If not explicitly found inside the document content, look for the worker's name in the file name "${fileName}". For example, in "10. LAPORAN DANA OPERASIONAL Bpk Suryo Pranoto - Bpk Hasby (Periode 17 - 23 Juni 2026).pdf", the worker name is "Bpk Suryo Pranoto & Bpk Hasby" or "Suryo Pranoto, Hasby". If no worker name can be found anywhere, use "Pekerja Lapangan")
6. Transaction Type: 'EXPENSE' or 'INCOME'

Also find the overall document summary if stated, such as:
- Total cash received (Total Penerimaan)
- Total cash spent (Total Pengeluaran)
- Worker/Field staff name (Check the file name "${fileName}" if the document itself doesn't mention it clearly. Do NOT leave this empty)
- Period / Month of report (Check the file name "${fileName}" for month/period if the document itself doesn't mention it clearly, e.g. "Juni 2026" or "17 - 23 Juni 2026")

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

    const modelsToTry = [
      "gemini-2.5-flash", 
      "gemini-flash-latest", 
      "gemini-3.1-flash-lite", 
      "gemini-3.5-flash"
    ];
    let response = null;
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting document analysis with model: ${modelName}`);
        response = await ai.models.generateContent({
          model: modelName,
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
                  required: ["totalIncome", "totalExpense", "remainingBalance", "workerName", "reportMonth"],
                },
              },
              required: ["transactions", "summary"],
            },
          },
        });
        
        if (response && response.text) {
          console.log(`Successfully completed document analysis using model: ${modelName}`);
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} encountered an error: ${err.message || err}. Trying next available model...`);
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error("All fallback models failed to analyze the document.");
    }

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
