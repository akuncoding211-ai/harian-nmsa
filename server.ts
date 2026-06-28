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

// Helper to get date string in Jakarta timezone
function getJakartaDateStr(): string {
  const d = new Date();
  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(d);
  const day = parts.find(p => p.type === "day")?.value || "01";
  const month = parts.find(p => p.type === "month")?.value || "01";
  const year = parts.find(p => p.type === "year")?.value || "2026";
  return `${year}-${month}-${day}`;
}

// Helper to generate deterministic daily pin using Asia/Jakarta date
function getAutomaticDailyPin(): string {
  const dateStr = getJakartaDateStr();
  
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
      if (!parsed.pettyCashHolders) {
        parsed.pettyCashHolders = ["Suryo Pranoto"];
      }
      if (!parsed.attendanceLogs) {
        parsed.attendanceLogs = [];
      }
      if (parsed.waMethod === undefined) {
        parsed.waMethod = "desktop";
      }
      if (parsed.autoReminderHour === undefined) {
        parsed.autoReminderHour = "09:00";
      }
      if (parsed.lastCronPing === undefined) {
        parsed.lastCronPing = "";
      }
      if (parsed.lastCronStatus === undefined) {
        parsed.lastCronStatus = "";
      }
      if (parsed.lastCronSentDate === undefined) {
        parsed.lastCronSentDate = "";
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
    signatures: {},
    pettyCashHolders: ["Suryo Pranoto"],
    attendanceLogs: [],
    waMethod: "desktop",
    autoReminderHour: "09:00",
    lastCronPing: "",
    lastCronStatus: "",
    lastCronSentDate: ""
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
    const { 
      workers, 
      attendanceRecords, 
      weeklyReports, 
      pettyCashReports, 
      attendancePin, 
      signatures, 
      pettyCashHolders, 
      attendanceLogs,
      waMethod,
      autoReminderHour,
      lastCronPing,
      lastCronStatus,
      lastCronSentDate
    } = req.body;
    const currentState = readState();

    // Merge workers list to avoid overwriting worker-updated profiles with stale admin state
    let mergedWorkers = currentState.workers || [];
    if (workers !== undefined) {
      const currentWorkersMap = new Map(mergedWorkers.map((w: any) => [w.id, w]));
      mergedWorkers = workers.map((incomingWorker: any) => {
        const serverWorker = currentWorkersMap.get(incomingWorker.id) as any;
        if (serverWorker) {
          const serverTime = serverWorker.updatedAt || 0;
          const incomingTime = incomingWorker.updatedAt || 0;
          if (serverTime > incomingTime) {
            // Keep the server's version of the worker (which was updated by the worker more recently)
            return serverWorker;
          }
        }
        return incomingWorker;
      });
    }

    const updatedState = {
      workers: mergedWorkers,
      attendanceRecords: attendanceRecords !== undefined ? attendanceRecords : currentState.attendanceRecords,
      weeklyReports: weeklyReports !== undefined ? weeklyReports : currentState.weeklyReports,
      pettyCashReports: pettyCashReports !== undefined ? pettyCashReports : currentState.pettyCashReports,
      attendancePin: attendancePin !== undefined ? attendancePin : currentState.attendancePin,
      signatures: signatures !== undefined ? signatures : currentState.signatures,
      pettyCashHolders: pettyCashHolders !== undefined ? pettyCashHolders : currentState.pettyCashHolders,
      attendanceLogs: attendanceLogs !== undefined ? attendanceLogs : currentState.attendanceLogs,
      waMethod: waMethod !== undefined ? waMethod : currentState.waMethod,
      autoReminderHour: autoReminderHour !== undefined ? autoReminderHour : currentState.autoReminderHour,
      lastCronPing: lastCronPing !== undefined ? lastCronPing : currentState.lastCronPing,
      lastCronStatus: lastCronStatus !== undefined ? lastCronStatus : currentState.lastCronStatus,
      lastCronSentDate: lastCronSentDate !== undefined ? lastCronSentDate : currentState.lastCronSentDate,
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

async function getReverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=id`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "PTNusantaraMineralSuksesAbadi/1.0 (akuncoding211@gmail.com)"
      }
    });
    if (response.ok) {
      const data = await response.json();
      return data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  } catch (err) {
    console.error("Gagal melakukan reverse geocoding:", err);
  }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// POST Self Attendance (Used by workers via WhatsApp links)
app.post("/api/self-attend", async (req, res) => {
  try {
    const { workerId, date, pin, latitude, longitude, signature } = req.body;
    if (!workerId || !date) {
      return res.status(400).json({ error: "ID pekerja dan tanggal wajib diisi." });
    }

    const state = readState();
    const workers = state.workers || [];
    const worker = workers.find((w: any) => w.id === workerId && w.isActive);
    const workerName = worker ? worker.name : "Karyawan Tidak Dikenal";

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "Verifikasi lokasi GPS wajib diaktifkan untuk melakukan presensi mandiri." });
    }

    const distance = calculateDistance(latitude, longitude, OFFICE_LAT, OFFICE_LON);
    const address = await getReverseGeocode(latitude, longitude);
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    // Ensure logs array exists
    if (!state.attendanceLogs) {
      state.attendanceLogs = [];
    }

    // Helper to log
    const addLog = (status: "BERHASIL" | "DITOLAK_LOKASI" | "DITOLAK_PIN") => {
      state.attendanceLogs.unshift({
        id: "LOG-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
        workerId,
        workerName,
        date,
        time: timeStr,
        latitude,
        longitude,
        distance: Math.round(distance),
        address,
        status
      });
      // Limit to last 500 logs
      if (state.attendanceLogs.length > 500) {
        state.attendanceLogs = state.attendanceLogs.slice(0, 500);
      }
    };

    if (distance > MAX_DISTANCE_METERS) {
      addLog("DITOLAK_LOKASI");
      writeState(state);
      return res.status(403).json({ 
        error: `Gagal absen: Lokasi Anda terlalu jauh (~${Math.round(distance)} meter) dari kantor. Maksimal jarak yang diperbolehkan adalah ${MAX_DISTANCE_METERS} meter.` 
      });
    }

    const serverPin = state.attendancePin || "1234";
    if (!pin) {
      return res.status(400).json({ error: "PIN presensi wajib dimasukkan." });
    }
    if (pin !== serverPin) {
      addLog("DITOLAK_PIN");
      writeState(state);
      return res.status(403).json({ error: "PIN presensi salah. Tanyakan PIN harian yang benar pada Mandor lapangan." });
    }

    if (!worker) {
      return res.status(404).json({ error: "Pekerja tidak ditemukan atau status tidak aktif." });
    }

    const records = state.attendanceRecords || [];

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

    addLog("BERHASIL");

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

// POST Update Worker Profile (by workers themselves)
app.post("/api/update-worker-profile", (req, res) => {
  try {
    const { workerId, bankName, bankAccount, phoneNumber, nik, photoUrl, name, role } = req.body;
    if (!workerId) {
      return res.status(400).json({ error: "ID pekerja wajib diisi." });
    }

    const state = readState();
    const workers = state.workers || [];

    const workerIndex = workers.findIndex((w: any) => w.id === workerId);
    if (workerIndex === -1) {
      return res.status(404).json({ error: "Pekerja tidak ditemukan." });
    }

    const worker = workers[workerIndex];
    if (bankName !== undefined) worker.bankName = bankName;
    if (bankAccount !== undefined) worker.bankAccount = bankAccount;
    if (phoneNumber !== undefined) worker.phoneNumber = phoneNumber;
    if (nik !== undefined) worker.nik = nik;
    if (photoUrl !== undefined) worker.photoUrl = photoUrl;
    if (name !== undefined && name.trim() !== "") worker.name = name;
    if (role !== undefined && role.trim() !== "") worker.role = role;
    worker.updatedAt = Date.now();

    writeState({
      ...state,
      workers
    });

    res.json({ 
      success: true, 
      message: "Profil Anda berhasil diperbarui!", 
      worker: worker
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gagal memperbarui profil." });
  }
});

// POST /api/worker-report (Worker reports a problem with their link/portal)
app.post("/api/worker-report", async (req, res) => {
  try {
    const { workerId, description } = req.body;
    if (!workerId) {
      return res.status(400).json({ error: "ID pekerja wajib diisi." });
    }

    const state = readState();
    const workers = state.workers || [];
    const worker = workers.find((w: any) => w.id === workerId);
    if (!worker) {
      return res.status(404).json({ error: "Pekerja tidak ditemukan." });
    }

    const todayYMD = getJakartaDateStr();
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" });

    // Ensure logs array exists
    if (!state.attendanceLogs) {
      state.attendanceLogs = [];
    }

    // Add to logs with LAPORAN_KENDALA status
    state.attendanceLogs.unshift({
      id: "LOG-REP-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
      workerId: worker.id,
      workerName: worker.name,
      date: todayYMD,
      time: timeStr,
      latitude: 0,
      longitude: 0,
      distance: 0,
      address: `Laporan kendala: ${description || "Link absensi bermasalah / tidak bisa diakses"}`,
      status: "LAPORAN_KENDALA"
    });

    if (state.attendanceLogs.length > 500) {
      state.attendanceLogs = state.attendanceLogs.slice(0, 500);
    }
    writeState(state);

    // Try sending WhatsApp notification
    const waStatus = getWhatsAppStatus();
    let sentToAdmin = false;
    let sentToRoles = 0;

    const messageText = `⚠️ *LAPORAN KENDALA LINK ABSENSI* 👷‍♂️\n\nHalo Admin / Mandor,\nPekerja berikut melaporkan kendala pada link absensi mereka hari ini:\n\n👤 *Nama:* ${worker.name}\n🆔 *ID:* ${worker.id}\n📞 *No. WA:* ${worker.phoneNumber || '-'}\n💼 *Jabatan:* ${worker.role}\n📅 *Waktu:* ${todayYMD} ${timeStr} WIB\n\n💬 *Kendala:* _${description || 'Terdapat kendala ketika membuka link absensi.'}_\n\n_Harap bantu verifikasi atau lakukan pencatatan kehadiran manual di dashboard admin._ 🙏`;

    if (waStatus.status === "connected") {
      // 1. Send to self (the logged in admin account) if possible
      if (waStatus.user?.id) {
        try {
          await sendWhatsAppMessage(waStatus.user.id, messageText);
          sentToAdmin = true;
        } catch (e) {
          console.error("Failed to send report to self/admin user:", e);
        }
      }

      // 2. Send to any other workers who are Admin, Mandor or Manager
      const adminWorkers = workers.filter((w: any) => 
        w.isActive && 
        w.phoneNumber && 
        (w.role?.toLowerCase().includes("admin") || 
         w.role?.toLowerCase().includes("mandor") || 
         w.role?.toLowerCase().includes("manager") || 
         w.role?.toLowerCase().includes("hr"))
      );

      for (const admin of adminWorkers) {
        try {
          await sendWhatsAppMessage(admin.phoneNumber, messageText);
          sentToRoles++;
        } catch (e) {
          console.error(`Failed to send report to admin/mandor worker (${admin.name}):`, e);
        }
      }
    }

    res.json({
      success: true,
      message: "Laporan kendala berhasil terkirim dan dicatat di dashboard Admin.",
      waSent: sentToAdmin || sentToRoles > 0,
      recipients: {
        adminSelf: sentToAdmin,
        adminRolesCount: sentToRoles
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gagal mengirim laporan kendala." });
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

// Endpoint to Parse Bank Statement PDF / Image
app.post("/api/parse-bank-statement", async (req, res) => {
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
      text: `Analyze this bank statement document (PDF/Image) and extract the statement details and all transaction rows.
The document's file name is: "${fileName}".
Strictly structure your response in Indonesian/English as specified below.
Ensure you capture:
1. Bank Name (e.g. BCA, MANDIRI, BRI, BNI, etc. - identify clearly)
2. Account Number / Nomor Rekening (if any)
3. Account Holder / Pemilik Rekening (if any)
4. Statement Period / Periode Rekening Koran
5. Transactions list:
   - Date (format YYYY-MM-DD or keep original if clear)
   - Description / Keterangan (description of mutasi)
   - Amount (numeric value only)
   - Type (DEBIT for money out / pengeluaran, CREDIT for money in / pemasukan)
   - Balance (the remaining balance after the transaction, numeric value only, if specified)

Also find the overall summary if stated:
- Total Debet (Pengeluaran/Debet)
- Total Kredit (Pemasukan/Kredit)
- Starting Balance (Saldo Awal)
- Ending Balance (Saldo Akhir)

Return a strict JSON response conforming exactly to this structure:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "TRANSFER DR BUDI",
      "amount": 500000,
      "type": "CREDIT",
      "balance": 2500000
    }
  ],
  "summary": {
    "bankName": "MANDIRI",
    "accountNumber": "1234567890",
    "accountHolder": "PT. Nusantara Mineral Sukses Abadi",
    "period": "Mei 2026",
    "totalDebit": 4500000,
    "totalCredit": 12000000,
    "startingBalance": 1000000,
    "endingBalance": 8500000
  }
}`,
    };

    console.log("Analyzing bank statement: size =" + fileBase64.length + " bytes, type =" + defaultMime);

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
        console.log(`Attempting bank statement analysis with model: ${modelName}`);
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
                      amount: { type: Type.INTEGER },
                      type: { type: Type.STRING, enum: ["DEBIT", "CREDIT"] },
                      balance: { type: Type.INTEGER },
                    },
                    required: ["date", "description", "amount", "type"],
                  },
                },
                summary: {
                  type: Type.OBJECT,
                  properties: {
                    bankName: { type: Type.STRING },
                    accountNumber: { type: Type.STRING },
                    accountHolder: { type: Type.STRING },
                    period: { type: Type.STRING },
                    totalDebit: { type: Type.INTEGER },
                    totalCredit: { type: Type.INTEGER },
                    startingBalance: { type: Type.INTEGER },
                    endingBalance: { type: Type.INTEGER },
                  },
                  required: ["bankName", "totalDebit", "totalCredit"],
                },
              },
              required: ["transactions", "summary"],
            },
          },
        });
        
        if (response && response.text) {
          console.log(`Successfully completed bank statement analysis using model: ${modelName}`);
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} encountered an error in bank statement: ${err.message || err}. Trying next available model...`);
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error("All fallback models failed to analyze the bank statement.");
    }

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No response received from Gemini engine");
    }

    const parsedData = JSON.parse(resultText);
    res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Bank Statement Parsing error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze bank statement" });
  }
});

// --- WHATSAPP BAILEYS BOT INTEGRATION ENDPOINTS ---
import { 
  initWhatsApp, 
  getWhatsAppStatus, 
  disconnectWhatsApp, 
  sendWhatsAppMessage,
  requestWhatsAppPairingCode
} from "./server/wa-bot.js";

// GET WhatsApp connection status
app.get("/api/wa/status", (req, res) => {
  res.json(getWhatsAppStatus());
});

// POST Disconnect WhatsApp connection
app.post("/api/wa/disconnect", async (req, res) => {
  const result = await disconnectWhatsApp();
  res.json(result);
});

// POST Request pairing code for phone linking
app.post("/api/wa/pairing-code", async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: "Nomor WhatsApp wajib diisi." });
  }
  try {
    const code = await requestWhatsAppPairingCode(phone);
    res.json({ success: true, code });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gagal membuat Kode Pairing." });
  }
});

// POST Send a test WhatsApp message manually
app.post("/api/wa/send-test", async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: "Nomor WhatsApp dan pesan wajib diisi." });
  }
  const result = await sendWhatsAppMessage(phone, message);
  res.json(result);
});

// Helper to determine weekday in Jakarta timezone ("Sunday"=0, "Saturday"=6, etc.)
function getJakartaDayOfWeek(dateStr: string): number {
  const parts = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    weekday: "long"
  });
  const dayName = weekdayFormatter.format(d);
  if (dayName === "Sunday") return 0;
  if (dayName === "Monday") return 1;
  if (dayName === "Tuesday") return 2;
  if (dayName === "Wednesday") return 3;
  if (dayName === "Thursday") return 4;
  if (dayName === "Friday") return 5;
  if (dayName === "Saturday") return 6;
  return d.getDay();
}

// Memory cache for Indonesian Holidays
let indonesianHolidaysCache: Record<string, { holiday: boolean; name: string }> | null = null;
let lastHolidaysFetchTime = 0;

// Fallback list of major national holidays in Indonesia (2026 and 2027)
const FALLBACK_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "Tahun Baru 2026 Masehi",
  "2026-01-29": "Tahun Baru Imlek 2577 Kongzili",
  "2026-02-15": "Isra Mikraj Nabi Muhammad SAW",
  "2026-03-11": "Hari Suci Nyepi Tahun Baru Saka 1948",
  "2026-03-20": "Wafat Yesus Kristus & Hari Raya Idul Fitri 1447 Hijriah",
  "2026-03-21": "Hari Raya Idul Fitri 1447 Hijriah",
  "2026-03-22": "Kenaikan Yesus Kristus",
  "2026-05-01": "Hari Buruh Internasional",
  "2026-05-13": "Hari Raya Waisak 2570 BE",
  "2026-05-21": "Kenaikan Yesus Kristus",
  "2026-06-01": "Hari Lahir Pancasila",
  "2026-06-27": "Hari Raya Idul Adha 1447 Hijriah",
  "2026-07-17": "Tahun Baru Islam 1448 Hijriah",
  "2026-08-17": "Hari Kemerdekaan Republik Indonesia",
  "2026-09-26": "Maulid Nabi Muhammad SAW",
  "2026-12-25": "Hari Raya Natal",
  "2027-01-01": "Tahun Baru 2027 Masehi",
  "2027-02-06": "Isra Mikraj Nabi Muhammad SAW",
  "2027-02-17": "Tahun Baru Imlek 2578 Kongzili",
  "2027-03-11": "Hari Suci Nyepi Tahun Baru Saka 1949",
  "2027-03-26": "Wafat Yesus Kristus",
  "2027-03-28": "Kenaikan Yesus Kristus",
  "2027-04-09": "Hari Raya Idul Fitri 1448 Hijriah",
  "2027-04-10": "Hari Raya Idul Fitri 1448 Hijriah",
  "2027-05-01": "Hari Buruh Internasional",
  "2027-05-20": "Hari Raya Waisak 2571 BE",
  "2027-05-27": "Kenaikan Yesus Kristus",
  "2027-06-01": "Hari Lahir Pancasila",
  "2027-06-16": "Hari Raya Idul Adha 1448 Hijriah",
  "2027-07-06": "Tahun Baru Islam 1449 Hijriah",
  "2027-08-17": "Hari Kemerdekaan Republik Indonesia",
  "2027-09-15": "Maulid Nabi Muhammad SAW",
  "2027-12-25": "Hari Raya Natal",
};

async function fetchIndonesianHolidays(): Promise<Record<string, { holiday: boolean; name: string }>> {
  const now = Date.now();
  // Cache holidays for 24 hours to prevent spamming GitHub Raw API
  if (indonesianHolidaysCache && (now - lastHolidaysFetchTime < 24 * 60 * 60 * 1000)) {
    return indonesianHolidaysCache;
  }
  try {
    console.log("Fetching Indonesian national holidays from GitHub Raw...");
    const res = await fetch("https://raw.githubusercontent.com/guangrei/Json-Indonesia-holidays/master/calendar.json", {
      headers: { "User-Agent": "PTNusantaraMineralSuksesAbadi/1.0" }
    });
    if (res.ok) {
      const data = await res.json();
      indonesianHolidaysCache = data;
      lastHolidaysFetchTime = now;
      console.log(`Fetched ${Object.keys(data).length} holiday definitions successfully.`);
      return data;
    }
  } catch (err) {
    console.error("Failed to fetch holidays dynamically, using fallback map:", err);
  }
  return indonesianHolidaysCache || {};
}

// Returns { isBlocked: boolean; reason: string | null }
async function checkIsHolidayOrWeekend(dateStr: string): Promise<{ isBlocked: boolean; reason: string | null }> {
  const dayOfWeek = getJakartaDayOfWeek(dateStr);
  if (dayOfWeek === 0) {
    return { isBlocked: true, reason: "Hari Minggu (Akhir Pekan)" };
  }
  if (dayOfWeek === 6) {
    return { isBlocked: true, reason: "Hari Sabtu (Akhir Pekan)" };
  }

  // Check online calendar API
  const holidays = await fetchIndonesianHolidays();
  if (holidays[dateStr] && holidays[dateStr].holiday) {
    return { isBlocked: true, reason: `Hari Libur Nasional: ${holidays[dateStr].name}` };
  }

  // Check fallback static map
  if (FALLBACK_HOLIDAYS[dateStr]) {
    return { isBlocked: true, reason: `Hari Libur Nasional: ${FALLBACK_HOLIDAYS[dateStr]}` };
  }

  return { isBlocked: false, reason: null };
}

// GET /api/cron-reminder (UptimeRobot automated pinger & manual click trigger)
app.get("/api/cron-reminder", async (req, res) => {
  const force = req.query.force === "true";
  const state = readState();
  const todayYMD = getJakartaDateStr();
  
  // Format neat local Indonesian time string
  const nowStr = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
  state.lastCronPing = `${todayYMD} ${nowStr} WIB`;
  
  // Get current Jakarta hour/minute
  const jktTimeString = new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Jakarta", hour12: false });
  const [currentHour, currentMinute] = jktTimeString.split(":").map(Number);
  
  // Parse scheduled hour/minute
  const scheduledTime = state.autoReminderHour || "09:00";
  const [targetHour, targetMinute] = scheduledTime.split(":").map(Number);

  // Conditions to trigger: force or (time is matched and not sent today yet)
  const isTimeTrigger = currentHour > targetHour || (currentHour === targetHour && currentMinute >= targetMinute);
  const alreadySentToday = state.lastCronSentDate === todayYMD;

  // Holiday and Weekend Check
  const holidayCheck = await checkIsHolidayOrWeekend(todayYMD);

  if (holidayCheck.isBlocked && !force) {
    // If it's Saturday, Sunday, or a National Holiday, we block the reminder and mark today as handled.
    const statusMsg = `Dilewati otomatis: ${holidayCheck.reason}.`;
    state.lastCronStatus = statusMsg;
    if (isTimeTrigger) {
      state.lastCronSentDate = todayYMD;
    }
    writeState(state);
    return res.json({
      success: true,
      message: `Pesan pengingat dilewati otomatis karena hari ini adalah ${holidayCheck.reason}`,
      isHoliday: true,
      reason: holidayCheck.reason,
      status: statusMsg
    });
  }

  if (force || (isTimeTrigger && !alreadySentToday)) {
    console.log(`Cron execution triggered: force=${force}, isTimeTrigger=${isTimeTrigger}, alreadySentToday=${alreadySentToday}`);
    
    // Check WhatsApp connection status
    const waStatus = getWhatsAppStatus();
    if (waStatus.status !== "connected") {
      state.lastCronStatus = `Gagal mengirim pengingat otomatis: WhatsApp Bot belum terhubung/scan.`;
      writeState(state);
      return res.status(500).json({ 
        success: false, 
        message: "Gagal: WhatsApp Bot belum terhubung. Silakan hubungkan via scan QR code di menu pengaturan admin terlebih dahulu." 
      });
    }

    const workers = state.workers || [];
    const records = state.attendanceRecords || [];
    const activeWorkers = workers.filter((w: any) => w.isActive);
    
    // Find workers who haven't checked in yet today
    const absentWorkers = activeWorkers.filter((worker: any) => {
      const record = records.find((r: any) => r.workerId === worker.id);
      return !record || !record.attendance || !record.attendance[todayYMD];
    });

    if (absentWorkers.length === 0) {
      state.lastCronStatus = `Selesai: Seluruh pekerja aktif (${activeWorkers.length}) sudah melakukan absen hadir hari ini.`;
      if (!force) {
        state.lastCronSentDate = todayYMD;
      }
      writeState(state);
      return res.json({ 
        success: true, 
        message: "Seluruh pekerja aktif sudah absen hari ini. Tidak ada pengingat yang perlu dikirim." 
      });
    }

    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    
    const hostOrigin = req.protocol + "://" + req.get("host");
    const currentPin = state.attendancePin || "1234";

    for (const worker of absentWorkers) {
      if (!worker.phoneNumber) {
        failedCount++;
        continue;
      }

      // Generate pre-filled PIN login URL!
      const loginUrl = `${hostOrigin}/?id=${worker.id}&pin=${currentPin}`;
      
      const message = `*PENGINGAT ABSENSI NUSANTARA* 👷‍♂️✨\n\nHalo, *${worker.name}*!\n\nKami mengingatkan Anda untuk segera melakukan absensi harian agar pencatatan Uang Makan harian (Rp 25.000) Anda tetap terhitung lancar.\n\nSekarang absensi sangat mudah! Anda tidak perlu menginput PIN harian secara manual lagi. Silakan *klik langsung* link di bawah ini dan tekan tombol *Absen Sekarang*:\n\n👉 *${loginUrl}*\n\n_Harap lakukan absensi sebelum jam kerja berakhir. Tetap utamakan keselamatan kerja ya! Terimakasih._ 🙏🏼`;

      const result = await sendWhatsAppMessage(worker.phoneNumber, message);
      if (result.success) {
        sentCount++;
      } else {
        failedCount++;
        if (result.error) errors.push(result.error);
      }
    }

    state.lastCronStatus = `Berhasil mengirim pengingat ke ${sentCount} pekerja.${failedCount > 0 ? ` Gagal: ${failedCount} pekerja.` : ""}`;
    if (!force) {
      state.lastCronSentDate = todayYMD;
    }
    writeState(state);

    return res.json({
      success: true,
      message: `Berhasil memproses cron pengingat. Terkirim: ${sentCount}, Gagal: ${failedCount}`,
      errors
    });
  } else {
    // Just a passive ping to keep server alive and update status
    let statusMsg = "";
    if (alreadySentToday) {
      statusMsg = `Selesai: Pengingat hari ini (${todayYMD}) sudah dikirimkan otomatis pada jam ${scheduledTime}.`;
    } else {
      statusMsg = `Standby: Menunggu jam target ${scheduledTime}. Waktu server saat ini: ${nowStr} WIB.`;
    }
    state.lastCronStatus = statusMsg;
    writeState(state);
    return res.json({
      success: true,
      message: "Cron ping recorded successfully.",
      time: nowStr,
      target: scheduledTime,
      status: statusMsg
    });
  }
});

// Vite Middleware for Development vs Production
async function startServer() {
  // Initialize WhatsApp connection
  try {
    console.log("Initializing server-side WhatsApp Baileys gateway...");
    initWhatsApp();
  } catch (err) {
    console.error("Failed to automatically initialize Baileys WhatsApp connection:", err);
  }

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
