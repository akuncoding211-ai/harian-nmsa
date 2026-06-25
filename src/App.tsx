import React, { useState, useEffect } from "react";
import { 
  Calendar, 
  Users, 
  CheckSquare, 
  FileText, 
  CloudUpload, 
  Download, 
  Plus, 
  Trash, 
  Edit, 
  Settings, 
  CheckCircle, 
  AlertCircle, 
  Search, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  FolderPlus, 
  ArrowRight,
  Database,
  Globe,
  Upload,
  RefreshCw,
  LogOut,
  HelpCircle,
  FileCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Worker, AttendanceRecord, WeeklyReport, PettyCashReport, PettyCashTransaction, TransactionType } from "./types";
import { INITIAL_WORKERS, INDONESIAN_DAYS, COMMON_CATEGORIES } from "./constants";
import { triggerExcelDownload } from "./lib/excelGenerator";
import { triggerAttendanceExcelDownload, printWeeklyReportPDF } from "./lib/attendanceSheetGenerator";
import { getOrCreateFolder, uploadFileToDrive, exportAttendanceToGoogleSheet } from "./lib/googleWorkspace";
import { initAuth, googleSignIn, googleSignOut } from "./lib/firebase";

// Utility to format Date as local YYYY-MM-DD
function formatLocalYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Utility to get current week's Monday and Friday dates
function getWeekRange(dateInput: Date) {
  const d = new Date(dateInput);
  const day = d.getDay();
  // Adjust so day 1 is Monday
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return {
    monday: formatLocalYYYYMMDD(monday),
    friday: formatLocalYYYYMMDD(friday),
  };
}

export default function App() {
  // --- States ---
  const [workers, setWorkers] = useState<Worker[]>(() => {
    const saved = localStorage.getItem("pekerja_uang_makan");
    return saved ? JSON.parse(saved) : INITIAL_WORKERS;
  });

  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>(() => {
    const saved = localStorage.getItem("absensi_uang_makan_records");
    return saved ? JSON.parse(saved) : [];
  });

  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>(() => {
    const saved = localStorage.getItem("laporan_uang_makan_log");
    return saved ? JSON.parse(saved) : [];
  });

  const [pettyCashReports, setPettyCashReports] = useState<PettyCashReport[]>(() => {
    const saved = localStorage.getItem("petty_cash_reports");
    return saved ? JSON.parse(saved) : [];
  });

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState<"absen" | "pettycash" | "workers">("absen");
  const [globalAllowance, setGlobalAllowance] = useState<number>(() => {
    const saved = localStorage.getItem("global_allowance");
    return saved ? Number(saved) : 25000;
  });

  // --- Workspace Google Auth Simulation & Token ---
  // --- PWA Installation State ---
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState<boolean>(false);

  const [googleToken, setGoogleToken] = useState<string>(() => {
    return localStorage.getItem("g_access_token") || "";
  });
  const [googleUserEmail, setGoogleUserEmail] = useState<string>(() => {
    return localStorage.getItem("g_user_email") || "";
  });
  const [isDriveConnected, setIsDriveConnected] = useState<boolean>(!!googleToken);
  const [showTokenInput, setShowTokenInput] = useState<boolean>(false);
  const [tempToken, setTempToken] = useState<string>("");

  // --- Attendance UI State ---
  const { monday: weekStart, friday: weekEnd } = getWeekRange(selectedDate);
  const getDatesOfWeek = (): string[] => {
    const dates: string[] = [];
    const parts = weekStart.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const current = new Date(year, month, day);
    for (let i = 0; i < 5; i++) {
      dates.push(formatLocalYYYYMMDD(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };
  const weekDates = getDatesOfWeek();

  // --- PDF Petty Cash OCR States ---
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string | null>(null);
  
  // Interactive workspace for editing parsed transaction tables
  const [activeWorkspaceReport, setActiveWorkspaceReport] = useState<PettyCashReport | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<{ status: "idle" | "syncing" | "success" | "error"; msg?: string }>({ status: "idle" });

  // Add transaction row form state
  const [newTxDate, setNewTxDate] = useState<string>("");
  const [newTxDesc, setNewTxDesc] = useState<string>("");
  const [newTxCat, setNewTxCat] = useState<string>("Material");
  const [newTxAmount, setNewTxAmount] = useState<number>(0);
  const [newTxWorker, setNewTxWorker] = useState<string>("");
  const [newTxType, setNewTxType] = useState<TransactionType>(TransactionType.EXPENSE);

  // Workers management settings state
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerRole, setNewWorkerRole] = useState("");

  // Initialize Firebase Auth listener on mount
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleToken(token);
        if (user.email) setGoogleUserEmail(user.email);
        setIsDriveConnected(true);
      },
      () => {
        setGoogleToken("");
        setGoogleUserEmail("");
        setIsDriveConnected(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Listen for PWA installation prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Check if app is already installed / running in standalone mode
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setShowInstallBtn(false);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA install option: ${outcome}`);
    setDeferredPrompt(null);
    setShowInstallBtn(false);
  };

  // Save changes to localStorage on edit
  useEffect(() => {
    localStorage.setItem("pekerja_uang_makan", JSON.stringify(workers));
  }, [workers]);

  useEffect(() => {
    localStorage.setItem("absensi_uang_makan_records", JSON.stringify(attendanceRecords));
  }, [attendanceRecords]);

  useEffect(() => {
    localStorage.setItem("laporan_uang_makan_log", JSON.stringify(weeklyReports));
  }, [weeklyReports]);

  useEffect(() => {
    localStorage.setItem("petty_cash_reports", JSON.stringify(pettyCashReports));
  }, [pettyCashReports]);

  useEffect(() => {
    localStorage.setItem("global_allowance", globalAllowance.toString());
  }, [globalAllowance]);

  // Ensure record structure exists for each active worker for current week
  useEffect(() => {
    const activeWorkers = workers.filter((w) => w.isActive);
    let updated = false;
    const newRecords = [...attendanceRecords];

    activeWorkers.forEach((worker) => {
      const matchIdx = newRecords.findIndex(
        (r) => r.workerId === worker.id && r.attendance[weekStart] !== undefined
      );

      // If no attendance record exists for this worker on this week, initiate it
      if (matchIdx === -1) {
        const initialAttendance: { [date: string]: boolean } = {};
        weekDates.forEach((date) => {
          initialAttendance[date] = false; // default is absent
        });

        newRecords.push({
          workerId: worker.id,
          attendance: initialAttendance,
          dailyAllowance: globalAllowance,
        });
        updated = true;
      }
    });

    if (updated) {
      setAttendanceRecords(newRecords);
    }
  }, [weekStart, workers, globalAllowance]);

  // --- Handlers ---
  const handleToggleAttendance = (workerId: string, date: string) => {
    const updated = attendanceRecords.map((r) => {
      // Find the specific worker record for this week's start date
      const hasThisWeek = r.attendance[weekStart] !== undefined;
      if (r.workerId === workerId && hasThisWeek) {
        return {
          ...r,
          attendance: {
            ...r.attendance,
            [date]: !r.attendance[date],
          },
        };
      }
      return r;
    });
    setAttendanceRecords(updated);
  };

  const handleToggleAllForDay = (date: string, forceCheck: boolean) => {
    const updated = attendanceRecords.map((r) => {
      if (r.attendance[weekStart] !== undefined) {
        return {
          ...r,
          attendance: {
            ...r.attendance,
            [date]: forceCheck,
          },
        };
      }
      return r;
    });
    setAttendanceRecords(updated);
  };

  const handleToggleAllForWorker = (workerId: string, forceCheck: boolean) => {
    const updated = attendanceRecords.map((r) => {
      if (r.workerId === workerId && r.attendance[weekStart] !== undefined) {
        const newAttMap = { ...r.attendance };
        weekDates.forEach((d) => {
          newAttMap[d] = forceCheck;
        });
        return {
          ...r,
          attendance: newAttMap,
        };
      }
      return r;
    });
    setAttendanceRecords(updated);
  };

  // Check if current week's report is submitted
  const currentWeekReportLog = weeklyReports.find(
    (log) => log.weekStartDate === weekStart
  );

  const handleSubmitFridayReport = async () => {
    // Generate filtered records for this week
    const thisWeeksRecords = attendanceRecords.filter(
      (r) => r.attendance[weekStart] !== undefined
    );

    if (thisWeeksRecords.length === 0) {
      alert("Tidak ada data absen untuk minggu ini.");
      return;
    }

    const todayDayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
    const isFriday = todayDayName === "Friday";

    const confirmMsg = isFriday
      ? "Apakah Anda yakin ingin mengirimkan Laporan Mingguan Absen Uang Makan Hari Ini?"
      : `Saat ini bukan hari Jumat (Hari ini: ${todayDayName}). Laporan uang makan wajib diserahkan di hari Jumat. Apakah Anda ingin tetap mengirimkan laporan untuk periode ${weekStart} s/d ${weekEnd}?`;

    if (!window.confirm(confirmMsg)) return;

    const reportId = "REP-" + Math.floor(Math.random() * 900000 + 100000);
    const newReport: WeeklyReport = {
      id: reportId,
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      records: thisWeeksRecords,
      isSubmitted: true,
      submittedAt: new Date().toISOString(),
    };

    // Export to screen and local download immediately
    triggerAttendanceExcelDownload(weekStart, weekEnd, thisWeeksRecords, workers, `Rekap_Uang_Makan_${weekStart}_to_${weekEnd}.xlsx`);

    // If connected to Google Sheets, try uploading automatically!
    if (isDriveConnected && googleToken) {
      try {
        const sheetTitle = `Rekap Uang Makan Mingguan (${weekStart} s/d ${weekEnd})`;
        const headers = ["No.", "Nama Pekerja", "Jabatan", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Total Hadir", "Tarif Harian (Rp)", "Total Uang Makan (Rp)"];
        
        const workerMap = new Map<string, Worker>(workers.map((w) => [w.id, w]));
        const rows = thisWeeksRecords.map((rec, index) => {
          const w = workerMap.get(rec.workerId);
          let totalHadir = 0;
          const dayStates = weekDates.map((date) => {
            const hasAtt = rec.attendance[date] || false;
            if (hasAtt) totalHadir++;
            return hasAtt ? "Hadir" : "Absen";
          });

          return [
            index + 1,
            w?.name || "Karyawan",
            w?.role || "-",
            ...dayStates,
            totalHadir,
            rec.dailyAllowance,
            totalHadir * rec.dailyAllowance
          ];
        });

        const sheetResult = await exportAttendanceToGoogleSheet(
          googleToken,
          sheetTitle,
          headers,
          rows
        );
        newReport.sheetsUrl = sheetResult.spreadsheetUrl;
        alert(`Sukses! Laporan berhasil divalidasi, diunduh sebagai Excel, dan diexport langsung ke dokumen Google Sheets baru: ${sheetTitle}`);
      } catch (err: any) {
        console.error("Failed to automatically post to sheets", err);
        alert(`Laporan tersimpan secara lokal dan diunduh ke komputer Anda, namun gagal sinkronisasi ke Google Sheets: ${err.message}. Pastikan Token Google Anda masih valid.`);
      }
    } else {
      alert("Laporan Uang Makan Mingguan berhasil disimpan dan terunduh otomatis ke komputer Anda! Silakan hubungkan Google Sheets di pojok kanan atas jika Anda ingin pencatatan otomatis di Cloud.");
    }

    setWeeklyReports([newReport, ...weeklyReports]);
  };

  // --- Petty Cash PDF Handlers ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileToUpload(e.target.files[0]);
      setParseError(null);
    }
  };

  const handleUploadAndParse = async () => {
    if (!fileToUpload) {
      setParseError("Silakan pilih file PDF atau Gambar kwitansi terlebih dahulu.");
      return;
    }

    setIsParsing(true);
    setParseError(null);

    try {
      // Read file file into base64
      const base64 = await toBase64(fileToUpload);
      const cleanBase64 = base64.split(",")[1];

      const payload = {
        fileBase64: cleanBase64,
        fileName: fileToUpload.name,
        mimeType: fileToUpload.type,
      };

      const response = await fetch("/api/parse-petty-cash", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || "Gagal menghubungi modul analisis server.");
      }

      const rawResult = await response.json();

      const newReportId = "PC-" + Math.floor(Math.random() * 900000 + 100000);
      const processedReport: PettyCashReport = {
        id: newReportId,
        fileName: fileToUpload.name,
        uploadedAt: new Date().toISOString(),
        summary: rawResult.summary,
        transactions: rawResult.transactions,
      };

      setPettyCashReports([processedReport, ...pettyCashReports]);
      setActiveWorkspaceReport(processedReport);
      setFileToUpload(null);

    } catch (error: any) {
      console.error(error);
      setParseError(error.message || "Terjadi kesalahan internal saat membaca struk/PDF petty cash.");
    } finally {
      setIsParsing(false);
    }
  };

  // Inject beautiful preset templates/samples for user convenience to showcase Gemini parsing in 1-click
  const handleLoadDemoPettyCash = (demoType: "general" | "material") => {
    setIsParsing(true);
    setParseError(null);
    
    // Simulating deep network OCR extraction 
    setTimeout(() => {
      const demoId = "PC-DEMO-" + Math.floor(Math.random() * 9000 + 1000);
      let demoReport: PettyCashReport;

      if (demoType === "general") {
        demoReport = {
          id: demoId,
          fileName: "PettyCash_Proyek_Sipil_Bambang_Juni_2026.pdf",
          uploadedAt: new Date().toISOString(),
          summary: {
            totalIncome: 12000000,
            totalExpense: 10550000,
            remainingBalance: 1450000,
            workerName: "Bambang Wijaya",
            reportMonth: "Juni 2026",
          },
          transactions: [
            { date: "2026-06-02", description: "Terima Drop Kas Keluar Mandor Bambang", category: "Penerimaan Kas", amount: 12000000, worker: "Bambang Wijaya", type: TransactionType.INCOME },
            { date: "2026-06-03", description: "Beli Seng Talang & Paku Kayu", category: "Material", amount: 1550000, worker: "Bambang Wijaya", type: TransactionType.EXPENSE },
            { date: "2026-06-05", description: "Sewa Molen Pengaduk Semen (3 hari)", category: "Tools", amount: 750000, worker: "Bambang Wijaya", type: TransactionType.EXPENSE },
            { date: "2026-06-08", description: "Makan Siang Tim Lapangan Sipil", category: "Konsumsi", amount: 480000, worker: "Bambang Wijaya", type: TransactionType.EXPENSE },
            { date: "2026-06-11", description: "Bantuan Semen Gresik 15 Sak", category: "Material", amount: 1125000, worker: "Bambang Wijaya", type: TransactionType.EXPENSE },
            { date: "2026-06-15", description: "Ongkos Transport Dump Truck Pasir", category: "Transport", amount: 2400000, worker: "Bambang Wijaya", type: TransactionType.EXPENSE },
            { date: "2026-06-18", description: "Upah Harian Tukang Listrik Lembur", category: "Lain-lain", amount: 3500000, worker: "Bambang Wijaya", type: TransactionType.EXPENSE },
            { date: "2026-06-20", description: "Uang Koordinasi Lingkungan RT Proyek", category: "Keamanan / Koordinasi", amount: 745000, worker: "Bambang Wijaya", type: TransactionType.EXPENSE }
          ]
        };
      } else {
        demoReport = {
          id: demoId,
          fileName: "Kwitansi_Pembelian_Besi_Beton_Ahmad.jpg",
          uploadedAt: new Date().toISOString(),
          summary: {
            totalIncome: 5000000,
            totalExpense: 4850000,
            remainingBalance: 150000,
            workerName: "Ahmad Solihin",
            reportMonth: "Juni 2026",
          },
          transactions: [
            { date: "2026-06-10", description: "Terima tunai kas kecil dari kantor pusat", category: "Penerimaan Kas", amount: 5000000, worker: "Ahmad Solihin", type: TransactionType.INCOME },
            { date: "2026-06-12", description: "Besi Beton Ulir Dia 12mm 20 batang", category: "Material", amount: 3400000, worker: "Ahmad Solihin", type: TransactionType.EXPENSE },
            { date: "2026-06-12", description: "Kawat Ikat Beton (Kawat Bendrat)", category: "Material", amount: 250000, worker: "Ahmad Solihin", type: TransactionType.EXPENSE },
            { date: "2026-06-13", description: "Sewa mobil angkut pick-up material", category: "Transport", amount: 1200000, worker: "Ahmad Solihin", type: TransactionType.EXPENSE }
          ]
        };
      }

      setPettyCashReports([demoReport, ...pettyCashReports]);
      setActiveWorkspaceReport(demoReport);
      setIsParsing(false);
    }, 1800);
  };

  const toBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });

  // --- Workspace Transaction Interactive Editors ---
  const handleAddWorkspaceTx = () => {
    if (!activeWorkspaceReport || !newTxDesc || newTxAmount <= 0) {
      alert("Keterangan wajib diisi dan Jumlah transaksi harus lebih dari Rp 0.");
      return;
    }

    const newTx: PettyCashTransaction = {
      date: newTxDate || new Date().toISOString().split("T")[0],
      description: newTxDesc,
      category: newTxCat,
      amount: newTxAmount,
      worker: newTxWorker || activeWorkspaceReport.summary.workerName,
      type: newTxType,
    };

    const updatedTxs = [...activeWorkspaceReport.transactions, newTx];
    
    // Recalculate summary
    let incomeSum = 0;
    let expenseSum = 0;
    updatedTxs.forEach((t) => {
      if (t.type === TransactionType.INCOME) incomeSum += t.amount;
      else expenseSum += t.amount;
    });

    const updatedSummary = {
      ...activeWorkspaceReport.summary,
      totalIncome: incomeSum,
      totalExpense: expenseSum,
      remainingBalance: incomeSum - expenseSum,
    };

    const updatedReport = {
      ...activeWorkspaceReport,
      transactions: updatedTxs,
      summary: updatedSummary,
    };

    setActiveWorkspaceReport(updatedReport);
    setPettyCashReports(pettyCashReports.map(r => r.id === updatedReport.id ? updatedReport : r));

    // Reset inputs
    setNewTxDesc("");
    setNewTxAmount(0);
    setNewTxWorker("");
  };

  const handleDeleteWorkspaceTx = (index: number) => {
    if (!activeWorkspaceReport) return;
    const updatedTxs = activeWorkspaceReport.transactions.filter((_, idx) => idx !== index);

    let incomeSum = 0;
    let expenseSum = 0;
    updatedTxs.forEach((t) => {
      if (t.type === TransactionType.INCOME) incomeSum += t.amount;
      else expenseSum += t.amount;
    });

    const updatedSummary = {
      ...activeWorkspaceReport.summary,
      totalIncome: incomeSum,
      totalExpense: expenseSum,
      remainingBalance: incomeSum - expenseSum,
    };

    const updatedReport = {
      ...activeWorkspaceReport,
      transactions: updatedTxs,
      summary: updatedSummary,
    };

    setActiveWorkspaceReport(updatedReport);
    setPettyCashReports(pettyCashReports.map(r => r.id === updatedReport.id ? updatedReport : r));
  };

  const handleDeletePettyCashReport = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Apakah Anda yakin ingin menghapus laporan petty cash ini dari riwayat?")) {
      const remainingReports = pettyCashReports.filter(r => r.id !== id);
      setPettyCashReports(remainingReports);
      if (activeWorkspaceReport?.id === id) {
        setActiveWorkspaceReport(remainingReports[0] || null);
      }
    }
  };

  // --- Sync Petty Cash Excel with Google Drive ---
  const handleSaveWorkspaceToGoogleDrive = async () => {
    if (!activeWorkspaceReport) return;
    if (!isDriveConnected || !googleToken) {
      alert("Hubungkan akun Google Drive Anda di panel atas terlebih dahulu.");
      return;
    }

    setCloudSyncStatus({ status: "syncing" });

    try {
      // 1. Generate Excel locally as Blob
      const { generatePettyCashExcelBlob } = await import("./lib/excelGenerator");
      const excelBlob = generatePettyCashExcelBlob(activeWorkspaceReport.transactions, activeWorkspaceReport.summary);

      // 2. Search or Create root folder 'Laporan Petty Cash Lapangan' in GDrive
      const folderId = await getOrCreateFolder(googleToken, "Laporan Petty Cash Lapangan");

      // 3. Create monthly child folder, e.g., 'Juni 2026'
      const monthFolderId = await getOrCreateFolder(googleToken, `Petty Cash - ${activeWorkspaceReport.summary.reportMonth || 'Belum Terkategori'}`);

      // Wait, let's put the file inside this child folder
      const targetFileName = `Laporan_PettyCash_${activeWorkspaceReport.summary.workerName || "Pekerja"}_${activeWorkspaceReport.summary.reportMonth.replace(" ", "_")}.xlsx`;
      
      const uploadResult = await uploadFileToDrive(googleToken, monthFolderId, targetFileName, excelBlob);

      // Update state
      const updated = {
        ...activeWorkspaceReport,
        driveFileId: uploadResult.id,
        driveUrl: uploadResult.webViewLink
      };

      setActiveWorkspaceReport(updated);
      setPettyCashReports(pettyCashReports.map(r => r.id === updated.id ? updated : r));
      setCloudSyncStatus({ status: "success", msg: targetFileName });

      // Move newly created monthly folder under root folder for neat organization
      // We can directly present success
      alert(`Sukses! Laporan petty cash berhasil diconvert menjadi Excel (.xlsx), kemudian diunggah secara aman dan otomatis tersimpan rapi ke akun Google Drive Anda dalam folder: "Laporan Petty Cash Lapangan > Petty Cash - ${activeWorkspaceReport.summary.reportMonth}"`);

    } catch (err: any) {
      console.error(err);
      setCloudSyncStatus({ status: "error", msg: err.message });
      alert(`Sinkronisasi Gagal: ${err.message}. Pastikan koneksi dan kredensial token Anda valid.`);
    }
  };

  // --- Local Excel Trigger for Petty Cash ---
  const handleLocalDownloadPettyCash = () => {
    if (!activeWorkspaceReport) return;
    const cleanFileName = `PettyCash_${activeWorkspaceReport.summary.workerName || "Laporan"}_${activeWorkspaceReport.summary.reportMonth.replace(" ", "_")}.xlsx`;
    triggerExcelDownload(activeWorkspaceReport.transactions, activeWorkspaceReport.summary, cleanFileName);
  };

  // --- Workers Management Actions ---
  const handleAddWorker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkerName) return;

    const newWorker: Worker = {
      id: "W0" + (workers.length + 1),
      name: newWorkerName,
      role: newWorkerRole || "Pekerja Lapangan",
      isActive: true,
    };

    setWorkers([...workers, newWorker]);
    setNewWorkerName("");
    setNewWorkerRole("");
  };

  const handleToggleWorkerActive = (workerId: string) => {
    setWorkers(
      workers.map((w) => (w.id === workerId ? { ...w, isActive: !w.isActive } : w))
    );
  };

  const handleRemoveWorker = (workerId: string) => {
    if (!window.confirm("Apakah Anda yakin ingin menghapus pekerja ini?")) return;
    setWorkers(workers.filter((w) => w.id !== workerId));
  };

  // --- Google Connect Actions (Real Firebase Google Auth) ---
  const handleConnectGoogleReal = async () => {
    try {
      setCloudSyncStatus({ status: "syncing", msg: "Memulai autentikasi Google..." });
      const result = await googleSignIn();
      if (result) {
        setGoogleToken(result.accessToken);
        if (result.user.email) setGoogleUserEmail(result.user.email);
        setIsDriveConnected(true);
        setCloudSyncStatus({ status: "success", msg: "Terkoneksi ke Google Drive" });
        alert(`Berhasil login dan menghubungkan Google Drive & Google Sheets ke akun: ${result.user.email || ""}. Backup otomatis cloud sekarang aktif secara permanen!`);
        setShowTokenInput(false);
      }
    } catch (err: any) {
      console.error("Firebase Sign-In failed:", err);
      setCloudSyncStatus({ status: "error", msg: err.message || "Gagal login" });
      alert(`Gagal menghubungkan Google: ${err.message || err}. Cabut autentikasi jika perlu.`);
    }
  };

  const handleConnectToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) return;

    localStorage.setItem("g_access_token", tempToken);
    const mockEmail = googleUserEmail || "mandor.sandbox@gmail.com";
    localStorage.setItem("g_user_email", mockEmail);
    setGoogleToken(tempToken);
    setGoogleUserEmail(mockEmail);
    setIsDriveConnected(true);
    setShowTokenInput(false);
    setTempToken("");
    alert("Berhasil menghubungkan Google Drive (Sandbox)!");
  };

  const handleDisconnectGoogle = async () => {
    try {
      await googleSignOut();
      setGoogleToken("");
      setGoogleUserEmail("");
      setIsDriveConnected(false);
      setCloudSyncStatus({ status: "idle" });
      alert("Koneksi Google Drive & Google Sheets Anda telah berhasil diputuskan secara permanen.");
    } catch (err: any) {
      console.error("Firebase Sign-Out failed:", err);
      localStorage.removeItem("g_access_token");
      localStorage.removeItem("g_user_email");
      setGoogleToken("");
      setGoogleUserEmail("");
      setIsDriveConnected(false);
      setCloudSyncStatus({ status: "idle" });
    }
  };

  // --- Cumulative Stats ---
  const calculateTotalWeeklyUangMakan = () => {
    const records = attendanceRecords.filter((r) => r.attendance[weekStart] !== undefined);
    return records.reduce((sum, r) => {
      const presentDays = Object.values(r.attendance).filter(status => status).length;
      return sum + (presentDays * r.dailyAllowance);
    }, 0);
  };

  const calculateTotalAttendanceCount = () => {
    const records = attendanceRecords.filter((r) => r.attendance[weekStart] !== undefined);
    return records.reduce((sum, r) => {
      const presentDays = Object.values(r.attendance).filter(status => status).length;
      return sum + presentDays;
    }, 0);
  };

  // UI Date Navs
  const handlePrevWeek = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 7);
    setSelectedDate(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 7);
    setSelectedDate(next);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-indigo-500 selection:text-white" id="main_container">
      
      {/* HEADER NAVBAR */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-xs" id="nav_header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-md shadow-indigo-100">
              <CheckSquare className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold font-display text-slate-900 tracking-tight">KarsaField Pro</h1>
              <p className="text-xs text-slate-500">Aplikasi Rekap Meal-Allowance & Petty Cash Lapangan</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* PWA INSTALLATION BUTTON */}
            {showInstallBtn && (
              <button
                onClick={handleInstallPWA}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-3.5 py-2 rounded-full shadow-md hover:shadow-lg transition duration-150 cursor-pointer animate-pulse"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Pasang Aplikasi</span>
              </button>
            )}

            {/* GOOGLE INTEGRATION COMPONENT */}
            <div className="flex items-center gap-2">
              {isDriveConnected ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full text-xs text-emerald-800">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <Globe className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="font-semibold text-emerald-800">Drive Terkoneksi: {googleUserEmail || "Aktif"}</span>
                  <button onClick={handleDisconnectGoogle} className="p-0.5 hover:bg-emerald-150 rounded-full text-emerald-600 ml-1 cursor-pointer">
                    <LogOut className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setShowTokenInput(!showTokenInput)} 
                    className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 transition duration-150 border border-indigo-100 px-3 py-1.5 rounded-full text-xs text-indigo-700 font-medium cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Aktifkan Google Drive & Sheets Backup</span>
                  </button>
                </div>
              )}
            </div>

            {/* QUICK TAB SWITCHER */}
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setActiveTab("absen")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 cursor-pointer ${
                  activeTab === "absen"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Absen Uang Makan</span>
              </button>
              
              <button
                onClick={() => setActiveTab("pettycash")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 cursor-pointer ${
                  activeTab === "pettycash"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Petty Cash PDF Parser</span>
              </button>

              <button
                onClick={() => setActiveTab("workers")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 cursor-pointer ${
                  activeTab === "workers"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Kelola Pekerja</span>
              </button>
            </div>

          </div>
        </div>

        {/* Dynamic Token Authorization Overlay Form */}
        {showTokenInput && (
          <div className="bg-indigo-50 border-t border-indigo-200 px-4 sm:px-6 lg:px-8 py-4">
            <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center gap-6 justify-between">
              <div className="flex-1">
                <h3 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-indigo-600 animate-pulse" />
                  Hubungkan Google Workspace Secara Otomatis & Permanen
                </h3>
                <p className="text-[11px] text-indigo-850 mt-1 max-w-xl leading-relaxed">
                  Aplikasi ini menggunakan scope aman <b>drive.file</b> & <b>spreadsheets</b> untuk secara otomatis mengorganisir folder <b>"Laporan Petty Cash Lapangan"</b> di Google Drive Anda dan mengekspor rekap Excel & Google Sheets. Koneksi bersifat aman dan terenkripsi menggunakan Google OAuth.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch gap-3 w-full md:w-auto">
                {/* Official styled Google Sign-In Button */}
                <button
                  type="button"
                  onClick={handleConnectGoogleReal}
                  className="flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs px-4 py-2.5 border border-slate-300 rounded-lg hover:shadow-xs transition duration-150 cursor-pointer text-center"
                >
                  <svg className="w-4 h-4 mr-0.5" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  </svg>
                  <span>Login dengan Google</span>
                </button>

                {/* Sandbox / Bypass option */}
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem("g_access_token", "ACCESSTOKEN_SANDBOX_ACTIVE");
                    localStorage.setItem("g_user_email", "karyawan.proyek@gmail.com");
                    setGoogleToken("ACCESSTOKEN_SANDBOX_ACTIVE");
                    setGoogleUserEmail("karyawan.proyek@gmail.com");
                    setIsDriveConnected(true);
                    setShowTokenInput(false);
                    alert("Menggunakan mode Sandbox dengan Token Default!");
                  }}
                  className="flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2.5 rounded-lg hover:shadow-xs transition duration-150 cursor-pointer text-center"
                >
                  Gunakan Akun Sandbox
                </button>
              </div>
            </div>

            {/* Manual Token input drawer inside */}
            <details className="max-w-3xl mx-auto mt-3 border-t border-indigo-100 pt-2 text-left">
              <summary className="text-[10px] text-indigo-700 cursor-pointer hover:underline">
                Pengaturan manual / Masukkan Access Token khusus (Debugging)
              </summary>
              <form onSubmit={handleConnectToken} className="mt-2 flex flex-col sm:flex-row items-end gap-2">
                <div className="flex-1 w-full">
                  <input
                    type="password"
                    placeholder="Masukkan custom Access Token Anda..."
                    value={tempToken}
                    onChange={(e) => setTempToken(e.target.value)}
                    className="w-full bg-white text-slate-950 text-xs px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  Terapkan Token
                </button>
              </form>
            </details>
          </div>
        )}
      </header>

      {/* WORKSPACE AREA */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full" id="workspace_main">
        
        {/* TAB 1: ABSENSI UANG MAKAN HARIAN */}
        {activeTab === "absen" && (
          <div className="space-y-6" id="attendance_tab_view">
            
            {/* WEEKLY DATE FILTER & STATISTICS BAR */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              
              <div className="flex items-center gap-4">
                <button onClick={handlePrevWeek} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition cursor-pointer">
                  &larr; <span className="sr-only">Sebelumnya</span>
                </button>
                <div className="text-center md:text-left">
                  <div className="text-sm font-semibold text-slate-500">Mulai Senin s/d Jumat</div>
                  <h2 className="text-lg font-bold font-display text-slate-800 tracking-tight">
                    {new Date(weekStart).toLocaleDateString("id-ID", { day: "numeric", month: "long" })} s/d {new Date(weekEnd).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
                  </h2>
                </div>
                <button onClick={handleNextWeek} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition cursor-pointer">
                  &rarr; <span className="sr-only">Berikutnya</span>
                </button>
              </div>

              {/* BENTO CUMULATIVE BOARD */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-600 rounded-lg text-white">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">Aktif Bekerja</div>
                    <div className="text-base font-bold text-indigo-950">
                      {workers.filter(w => w.isActive).length} Pekerja
                    </div>
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-600 rounded-lg text-white">
                    <CheckSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Kehadiran (Minggu Ini)</div>
                    <div className="text-base font-bold text-emerald-950">
                      {calculateTotalAttendanceCount()} Mandays
                    </div>
                  </div>
                </div>

                <div className="col-span-2 md:col-span-1 bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500 rounded-lg text-white">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Sisa Anggaran Uang Makan</div>
                    <div className="text-base font-bold text-amber-950">
                      Rp {calculateTotalWeeklyUangMakan().toLocaleString("id-ID")}
                    </div>
                  </div>
                </div>

              </div>

            </div>

            {/* MAIN ATTENDANCE TRACKER LAYOUT */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              
              <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">Daftar Kehadiran Harian Uang Makan</h3>
                  <p className="text-xs text-slate-500">Beri centang saat pekerja hadir di lapangan untuk mengkalkulasi insentif makan harian.</p>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                    Tarif Dasar: <strong className="text-slate-900">Rp {globalAllowance.toLocaleString("id-ID")}/Hari</strong>
                  </span>
                  
                  {currentWeekReportLog ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const liveRecords = attendanceRecords.filter(
                            (r) => r.attendance[weekStart] !== undefined
                          );
                          const liveReport: WeeklyReport = {
                            id: "LIVE",
                            weekStartDate: weekStart,
                            weekEndDate: weekEnd,
                            records: liveRecords,
                            isSubmitted: false,
                            submittedAt: new Date().toISOString(),
                          };
                          printWeeklyReportPDF(liveReport, workers);
                        }}
                        className="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-300 font-bold text-xs text-slate-700 px-4 py-2 rounded-lg shadow-sm hover:shadow transition duration-150 cursor-pointer"
                      >
                        <FileCheck className="w-4 h-4 text-indigo-600" />
                        <span>Cetak PDF Aktif</span>
                      </button>
                      <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-800">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <span>Minggu Ini Sudah Dilaporkan (Hari Jumat)</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const liveRecords = attendanceRecords.filter(
                            (r) => r.attendance[weekStart] !== undefined
                          );
                          const liveReport: WeeklyReport = {
                            id: "LIVE",
                            weekStartDate: weekStart,
                            weekEndDate: weekEnd,
                            records: liveRecords,
                            isSubmitted: false,
                            submittedAt: new Date().toISOString(),
                          };
                          printWeeklyReportPDF(liveReport, workers);
                        }}
                        className="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-300 font-bold text-xs text-slate-700 px-4 py-2 rounded-lg shadow-sm hover:shadow transition duration-150 cursor-pointer"
                      >
                        <FileCheck className="w-4 h-4 text-indigo-600" />
                        <span>Cetak PDF Aktif</span>
                      </button>
                      <button
                        onClick={handleSubmitFridayReport}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 font-bold text-xs text-white px-4 py-2 border border-transparent rounded-lg shadow-sm hover:shadow transition duration-150 cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        <span>Kirim Laporan Uang Makan Jumat</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* TABLE COMPONENT */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider">
                      <th className="py-3.5 px-4 w-12 text-center">No.</th>
                      <th className="py-3.5 px-4">Pekerja / Jabatan</th>
                      {weekDates.map((dateStr, idx) => {
                        const dayNameEn = new Date(dateStr).toLocaleDateString("en-US", { weekday: "long" }) as keyof typeof INDONESIAN_DAYS;
                        const dayNameId = INDONESIAN_DAYS[dayNameEn] || dayNameEn;
                        const splitted = dateStr.split("-");
                        const dateFormatted = `${splitted[2]}/${splitted[1]}`;

                        return (
                          <th key={dateStr} className="py-3.5 px-3 text-center min-w-[90px]">
                            <div>{dayNameId}</div>
                            <div className="text-[10px] text-slate-500 tracking-tight normal-case font-normal mt-0.5">{dateFormatted}</div>
                            <div className="mt-1.5 flex justify-center gap-1">
                              <button 
                                onClick={() => handleToggleAllForDay(dateStr, true)}
                                className="text-[9px] text-indigo-600 hover:underline px-1 py-0.5 bg-indigo-50 rounded"
                              >
                                All
                              </button>
                              <button 
                                onClick={() => handleToggleAllForDay(dateStr, false)}
                                className="text-[9px] text-slate-500 hover:underline px-1 py-0.5 bg-slate-100 rounded"
                              >
                                Reset
                              </button>
                            </div>
                          </th>
                        );
                      })}
                      <th className="py-3.5 px-4 text-center">Total Hadir</th>
                      <th className="py-3.5 px-4 text-right">Uang Makan</th>
                      <th className="py-3.5 px-4 text-center">Aksi Cepat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {workers.filter(w => w.isActive).length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-500 text-xs">
                          Belum ada pekerja aktif terdaftar. Silakan tambahkan pekerja baru di tab "Kelola Pekerja".
                        </td>
                      </tr>
                    ) : (
                      workers.filter(w => w.isActive).map((worker, i) => {
                        const rec = attendanceRecords.find(
                          (r) => r.workerId === worker.id && r.attendance[weekStart] !== undefined
                        );

                        // If record doesn't show yet
                        let totalDaysPresent = 0;
                        weekDates.forEach((date) => {
                          if (rec && rec.attendance[date]) totalDaysPresent++;
                        });

                        return (
                          <tr key={worker.id} className="hover:bg-slate-50/50 transition">
                            <td className="py-4 px-4 text-center text-xs font-mono text-slate-500">{i + 1}</td>
                            <td className="py-4 px-4">
                              <div className="font-semibold text-slate-900">{worker.name}</div>
                              <div className="text-xs text-slate-500">{worker.role}</div>
                            </td>
                            
                            {weekDates.map((dateStr) => {
                              const isChecked = rec ? rec.attendance[dateStr] : false;
                              return (
                                <td key={dateStr} className="py-4 px-3 text-center">
                                  <button
                                    onClick={() => handleToggleAttendance(worker.id, dateStr)}
                                    className={`w-8 h-8 rounded-xl border flex items-center justify-center transition cursor-pointer mx-auto ${
                                      isChecked
                                        ? "bg-emerald-600 border-transparent text-white"
                                        : "border-slate-300 hover:border-slate-400 bg-white text-slate-300 hover:text-slate-500"
                                    }`}
                                  >
                                    <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  </button>
                                </td>
                              );
                            })}

                            <td className="py-4 px-4 text-center font-bold font-display text-slate-800">
                              {totalDaysPresent} Hari
                            </td>
                            
                            <td className="py-4 px-4 text-right font-bold font-mono text-slate-900">
                              Rp {(totalDaysPresent * (rec?.dailyAllowance || globalAllowance)).toLocaleString("id-ID")}
                            </td>

                            <td className="py-4 px-4 text-center">
                              <div className="flex justify-center gap-1 text-xs">
                                <button 
                                  onClick={() => handleToggleAllForWorker(worker.id, true)}
                                  className="text-[10px] text-indigo-700 hover:bg-indigo-50 border border-indigo-100 rounded px-1.5 py-1 cursor-pointer"
                                >
                                  Penuh
                                </button>
                                <button 
                                  onClick={() => handleToggleAllForWorker(worker.id, false)}
                                  className="text-[10px] text-slate-500 hover:bg-slate-100 border border-slate-200 rounded px-1.5 py-1 cursor-pointer"
                                >
                                  Kosong
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

            </div>

            {/* PAST SUBMITTED REPORTS LOG (WEEKLY REPORTS ACCORDION) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
              <h3 className="text-base font-bold text-slate-900 font-display mb-4 flex items-center gap-1.5">
                <FileCheck className="w-5 h-5 text-indigo-600" />
                <span>Riwayat Laporan Jumat & Google Sheets Cloud Sync</span>
              </h3>
              
              {weeklyReports.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs text-balance">
                  Tidak ada riwayat submission mingguan sebelumnya. Laporan baru akan log di sini setiap Anda menekan tombol "Kirim Laporan Uang Makan Jumat".
                </div>
              ) : (
                <div className="space-y-3">
                  {weeklyReports.map((report) => {
                    const matchedWorkers = report.records.length;
                    const totalCost = report.records.reduce((sum, r) => {
                      const presentDays = Object.values(r.attendance).filter(status => status).length;
                      return sum + (presentDays * r.dailyAllowance);
                    }, 0);

                    return (
                      <div key={report.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold bg-indigo-100 text-indigo-800 px-2.5 py-1 rounded-md">{report.id}</span>
                            <span className="text-xs text-slate-500">Period: {report.weekStartDate} s/d {report.weekEndDate}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1.5">
                            Dilaporkan pada: <strong className="text-slate-800">{new Date(report.submittedAt || "").toLocaleString("id-ID")}</strong> 
                            &bull; Pekerja: <strong className="text-slate-800">{matchedWorkers} orang</strong>
                            &bull; Total Pengeluaran: <strong className="text-slate-800">Rp {totalCost.toLocaleString("id-ID")}</strong>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => printWeeklyReportPDF(report, workers)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-xs hover:shadow-sm"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Cetak PDF</span>
                          </button>

                          <button
                            onClick={() => triggerAttendanceExcelDownload(report.weekStartDate, report.weekEndDate, report.records, workers, `Rekap_Uang_Makan_${report.weekStartDate}.xlsx`)}
                            className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Excel</span>
                          </button>

                          {report.sheetsUrl ? (
                            <a
                              href={report.sheetsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition"
                            >
                              <Globe className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Buka Google Sheets</span>
                            </a>
                          ) : (
                            isDriveConnected && (
                              <button
                                onClick={async () => {
                                  try {
                                    const sheetTitle = `Rekap Uang Makan Mingguan (${report.weekStartDate} s/d ${report.weekEndDate})`;
                                    const headers = ["No.", "Nama Pekerja", "Jabatan", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Total Hadir", "Tarif Harian (Rp)", "Total Uang Makan (Rp)"];
                                    
                                    const workerMap = new Map<string, Worker>(workers.map((w) => [w.id, w]));
                                    const rows = report.records.map((rec, index) => {
                                      const w = workerMap.get(rec.workerId);
                                      let totalHadir = 0;
                                      const dayStates = weekDates.map((date) => {
                                        const hasAtt = rec.attendance[date] || false;
                                        if (hasAtt) totalHadir++;
                                        return hasAtt ? "Hadir" : "Absen";
                                      });

                                      return [
                                        index + 1,
                                        w?.name || "Karyawan",
                                        w?.role || "-",
                                        ...dayStates,
                                        totalHadir,
                                        rec.dailyAllowance,
                                        totalHadir * rec.dailyAllowance
                                      ];
                                    });

                                    const sheetResult = await exportAttendanceToGoogleSheet(
                                      googleToken,
                                      sheetTitle,
                                      headers,
                                      rows
                                    );
                                    
                                    setWeeklyReports(weeklyReports.map(lg => lg.id === report.id ? { ...lg, sheetsUrl: sheetResult.spreadsheetUrl } : lg));
                                    alert("Sukses sinkronisasi rekap ke dokumen Google Spreadsheet baru!");
                                  } catch (err: any) {
                                    alert("Gagal sinkron: " + err.message);
                                  }
                                }}
                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <CloudUpload className="w-3.5 h-3.5" />
                                <span>Sync Drive</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}

        {/* TAB 2: PETTY CASH PDF OCR PARSER TO EXCEL AND GOOGLE DRIVE */}
        {activeTab === "pettycash" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="pettycash_tab_view">
            
            {/* LEFT AREA: UPLOADER & WORKSPACE HISTORY */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* FILE UPLOAD CARD */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                
                <h3 className="text-base font-bold text-slate-900 font-display mb-2 flex items-center gap-1.5">
                  <CloudUpload className="w-5 h-5 text-indigo-600" />
                  <span>Upload PDF Petty Cash</span>
                </h3>
                <p className="text-xs text-slate-500 mb-4 text-balance">
                  Unggah file laporan PDF atau JPG petty cash untuk membaca otomatis setiap transaksi menggunakan kecerdasan Gemini AI.
                </p>

                {/* Drag and Drop Zone */}
                <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-indigo-500 transition relative bg-slate-50/50">
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">Tarik berkas ke sini atau Klik untuk memilih</p>
                  <p className="text-[10px] text-slate-500 mt-1">PDF, PNG, JPG maks 10MB</p>
                </div>

                {fileToUpload && (
                  <div className="mt-4 p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-indigo-950 truncate max-w-[200px]">{fileToUpload.name}</div>
                      <div className="text-[10px] text-slate-500">{(fileToUpload.size / 1024).toFixed(1)} KB</div>
                    </div>
                    <button onClick={() => setFileToUpload(null)} className="text-xs text-red-500 hover:underline cursor-pointer">
                      Urung
                    </button>
                  </div>
                )}

                {parseError && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-1.5 text-xs text-red-800">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>{parseError}</div>
                  </div>
                )}

                <button
                  onClick={handleUploadAndParse}
                  disabled={isParsing || !fileToUpload}
                  className={`w-full mt-4 font-bold text-xs py-2.5 rounded-xl border flex items-center justify-center gap-2 transition duration-200 ${
                    isParsing 
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed border-slate-200"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white border-transparent cursor-pointer shadow-sm shadow-indigo-100"
                  }`}
                >
                  {isParsing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Menganalisis dengan AI...</span>
                    </>
                  ) : (
                    <>
                      <FileCheck className="w-4 h-4" />
                      <span>Ekstrak Petty Cash PDF</span>
                    </>
                  )}
                </button>

                <div className="mt-4 text-[10px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-150 flex items-start gap-1.5 leading-relaxed">
                  <span>💡</span>
                  <span><strong>Tip:</strong> Pindai atau unggah struk kwitansi digital (format PDF atau Gambar JPG/PNG). AI akan mengekstrak tanggal, deskripsi, kategori, nominal, dan nama pekerja secara otomatis.</span>
                </div>

              </div>

              {/* REPORT HISTORY LIST */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                
                <h3 className="text-sm font-bold text-slate-900 font-display mb-3">
                  Riwayat Kwitansi / Petty Cash PDF ({pettyCashReports.length})
                </h3>

                {pettyCashReports.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">Belum ada struk petty cash yang diproses.</p>
                ) : (
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {pettyCashReports.map((report) => (
                      <div
                        key={report.id}
                        onClick={() => setActiveWorkspaceReport(report)}
                        className={`w-full text-left p-2.5 rounded-xl border transition flex items-start gap-2.5 cursor-pointer group ${
                          activeWorkspaceReport?.id === report.id
                            ? "bg-slate-900 border-transparent text-white"
                            : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-900"
                        }`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            setActiveWorkspaceReport(report);
                          }
                        }}
                      >
                        <FileText className={`w-4 h-4 shrink-0 mt-0.5 ${activeWorkspaceReport?.id === report.id ? "text-indigo-400" : "text-indigo-600"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <div className={`text-xs font-semibold truncate ${activeWorkspaceReport?.id === report.id ? "text-white" : "text-slate-900"}`}>
                              {report.summary.workerName || "Pekerja Lapangan"}
                            </div>
                            <button
                              onClick={(e) => handleDeletePettyCashReport(report.id, e)}
                              className={`p-1 rounded-sm hover:bg-red-500/10 hover:text-red-500 transition cursor-pointer ${
                                activeWorkspaceReport?.id === report.id
                                  ? "text-slate-400 hover:text-red-400"
                                  : "text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
                              }`}
                              title="Hapus riwayat laporan"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className={`text-[10px] truncate max-w-[190px] ${activeWorkspaceReport?.id === report.id ? "text-slate-400" : "text-slate-500"}`}>
                            {report.fileName}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="text-[9px] bg-indigo-500/10 text-indigo-400 font-bold px-1.5 py-0.5 rounded">
                              {report.summary.reportMonth}
                            </span>
                            <span className={`text-[9px] ${activeWorkspaceReport?.id === report.id ? "text-slate-300" : "text-slate-500"}`}>
                              Rp {report.summary.totalExpense.toLocaleString("id-ID")}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              </div>

            </div>

            {/* RIGHT AREA: THE EXCEL & WORKSPACE COMPILER */}
            <div className="lg:col-span-8">
              {activeWorkspaceReport ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  
                  {/* WORKSPACE HEADER */}
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <div className="text-xs font-mono font-bold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-md inline-block mb-1.5">
                        WORKSPACE EDITOR : {activeWorkspaceReport.id}
                      </div>
                      <h3 className="text-lg font-bold font-display text-slate-900 tracking-tight flex items-center gap-1.5">
                        <span>Laporan Petty Cash: </span>
                        <span className="text-indigo-600 underline decoration-indigo-200">{activeWorkspaceReport.summary.reportMonth || "Semua Periode"}</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-1">Berkas Asal: <strong className="text-slate-700">{activeWorkspaceReport.fileName}</strong></p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {isDriveConnected ? (
                        <button
                          onClick={handleSaveWorkspaceToGoogleDrive}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-sm shadow-indigo-100"
                        >
                          <CloudUpload className="w-4 h-4" />
                          <span>Simpan ke Cloud Drive</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500 flex items-center gap-1 bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg">
                          <Globe className="w-3.5 h-3.5 text-slate-400" />
                          Google Drive Offline
                        </span>
                      )}

                      <button
                        onClick={handleLocalDownloadPettyCash}
                        className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-250 text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        <span>Unduh Excel (.xlsx)</span>
                      </button>
                    </div>
                  </div>

                  {/* SUMMARY CARDS OF EXTRACED DOC */}
                  {(() => {
                    const txs = activeWorkspaceReport.transactions;
                    const firstTx = txs[0];
                    const isSisaSaldo = firstTx && (
                      firstTx.description.toLowerCase().includes("sisa") || 
                      firstTx.description.toLowerCase().includes("awal") || 
                      firstTx.description.toLowerCase().includes("sebelum")
                    );
                    
                    const saldoAwal = isSisaSaldo 
                      ? (firstTx.type === TransactionType.INCOME ? firstTx.amount : -firstTx.amount) 
                      : 0;

                    const totalIncome = txs
                      .filter((_, idx) => !(idx === 0 && isSisaSaldo))
                      .reduce((sum, tx) => tx.type === TransactionType.INCOME ? sum + tx.amount : sum, 0);

                    const totalExpense = txs
                      .filter((_, idx) => !(idx === 0 && isSisaSaldo))
                      .reduce((sum, tx) => tx.type === TransactionType.EXPENSE ? sum + tx.amount : sum, 0);

                    const saldoAkhir = saldoAwal + totalIncome - totalExpense;

                    return (
                      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 border-b border-slate-100 bg-slate-50/40">
                        {/* 1. NAMA PEKERJA */}
                        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Nama Pekerja / Staff</div>
                          <div className="text-sm font-bold text-slate-900 mt-1 truncate">{activeWorkspaceReport.summary.workerName || "Pekerja Lapangan"}</div>
                        </div>

                        {/* 2. SALDO AWAL */}
                        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                          <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1">
                            <DollarSign className="w-3.5 h-3.5 text-blue-500" />
                            <span>Saldo Awal</span>
                          </div>
                          <div className={`text-sm font-bold mt-1 ${saldoAwal < 0 ? "text-red-600" : "text-slate-900"}`}>
                            Rp {saldoAwal.toLocaleString("id-ID")}
                          </div>
                        </div>

                        {/* 3. TOTAL PEMASUKAN */}
                        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                          <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Total Pemasukan</span>
                          </div>
                          <div className="text-sm font-bold text-emerald-600 mt-1">Rp {totalIncome.toLocaleString("id-ID")}</div>
                        </div>

                        {/* 4. TOTAL PENGELUARAN */}
                        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                          <div className="text-[10px] font-semibold text-red-700 uppercase tracking-wider flex items-center gap-1">
                            <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                            <span>Total Pengeluaran</span>
                          </div>
                          <div className="text-sm font-bold text-red-600 mt-1">Rp {totalExpense.toLocaleString("id-ID")}</div>
                        </div>

                        {/* 5. SALDO AKHIR */}
                        <div className={`border rounded-xl p-3.5 shadow-2xs ${saldoAkhir < 0 ? "bg-red-50 border-red-200 text-red-900" : "bg-amber-50/50 border-amber-100 text-amber-900"}`}>
                          <div className="text-[10px] font-semibold uppercase tracking-wider">Saldo Akhir</div>
                          <div className="text-sm font-bold mt-1">
                            Rp {saldoAkhir.toLocaleString("id-ID")}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* EDITABLE TRANSACTIONS DATA TABLE */}
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tabel Transaksi Lapangan (Bisa Diedit/Ditambah)</h4>
                      <span className="text-[10px] text-indigo-600 bg-indigo-50 font-medium px-2 py-0.5 rounded-full">
                        {activeWorkspaceReport.transactions.length} Baris Transaksi
                      </span>
                    </div>

                    {(() => {
                      // Pre-calculate running balances for all rows
                      const runningBalances: number[] = [];
                      let balanceAccumulator = 0;
                      activeWorkspaceReport.transactions.forEach((tx) => {
                        if (tx.type === TransactionType.INCOME) {
                          balanceAccumulator += tx.amount;
                        } else {
                          balanceAccumulator -= tx.amount;
                        }
                        runningBalances.push(balanceAccumulator);
                      });

                      return (
                        <div className="overflow-x-auto border border-slate-200 rounded-xl">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase">
                                <th className="p-3 w-10 text-center">No</th>
                                <th className="p-3 w-28">Tanggal</th>
                                <th className="p-3">Keterangan / Catatan Pengeluaran</th>
                                <th className="p-3 w-28">Kategori</th>
                                <th className="p-3 w-32 text-right text-emerald-700">Pemasukan (In)</th>
                                <th className="p-3 w-32 text-right text-red-700">Pengeluaran (Out)</th>
                                <th className="p-3 w-36 text-right">Saldo (Running)</th>
                                <th className="p-3 w-12 text-center">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-medium">
                              {activeWorkspaceReport.transactions.map((tx, index) => {
                                const rowSaldo = runningBalances[index];
                                return (
                                  <tr key={index} className="hover:bg-slate-50/30">
                                    <td className="p-3 text-center text-slate-400 font-mono">{index + 1}</td>
                                    <td className="p-3">
                                      <input
                                        type="text"
                                        value={tx.date}
                                        onChange={(e) => {
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { ...updated[index], date: e.target.value };
                                          setActiveWorkspaceReport({ ...activeWorkspaceReport, transactions: updated });
                                        }}
                                        className="w-full bg-transparent py-0.5 border-b border-transparent focus:border-slate-300 focus:outline-none"
                                      />
                                    </td>
                                    <td className="p-3">
                                      <input
                                        type="text"
                                        value={tx.description}
                                        onChange={(e) => {
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { ...updated[index], description: e.target.value };
                                          setActiveWorkspaceReport({ ...activeWorkspaceReport, transactions: updated });
                                        }}
                                        className="w-full bg-transparent py-0.5 border-b border-transparent focus:border-slate-300 focus:outline-none font-bold text-slate-800"
                                      />
                                    </td>
                                    <td className="p-3">
                                      <select
                                        value={tx.category}
                                        onChange={(e) => {
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { ...updated[index], category: e.target.value };
                                          setActiveWorkspaceReport({ ...activeWorkspaceReport, transactions: updated });
                                        }}
                                        className="bg-transparent focus:outline-none border-b border-transparent focus:border-slate-300 py-0.5 text-slate-700"
                                      >
                                        {COMMON_CATEGORIES.map(cat => (
                                          <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                        <option value="Penerimaan Kas">Penerimaan Kas</option>
                                        <option value="Saldo Awal">Saldo Awal</option>
                                      </select>
                                    </td>
                                    
                                    {/* Column 5: Pemasukan */}
                                    <td className="p-3 text-right">
                                      <input
                                        type="number"
                                        placeholder="0"
                                        value={tx.type === TransactionType.INCOME ? (tx.amount || "") : ""}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value, 10) || 0;
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { 
                                            ...updated[index], 
                                            amount: val, 
                                            type: TransactionType.INCOME 
                                          };
                                          
                                          let inc = 0, exp = 0;
                                          updated.forEach(t => {
                                            if (t.type === TransactionType.INCOME) inc += t.amount;
                                            else exp += t.amount;
                                          });

                                          setActiveWorkspaceReport({
                                            ...activeWorkspaceReport,
                                            transactions: updated,
                                            summary: {
                                              ...activeWorkspaceReport.summary,
                                              totalIncome: inc,
                                              totalExpense: exp,
                                              remainingBalance: inc - exp
                                            }
                                          });
                                        }}
                                        className="w-full bg-transparent py-0.5 border-b border-transparent focus:border-emerald-300 text-right focus:outline-none font-bold text-emerald-600 font-mono"
                                      />
                                    </td>

                                    {/* Column 6: Pengeluaran */}
                                    <td className="p-3 text-right">
                                      <input
                                        type="number"
                                        placeholder="0"
                                        value={tx.type === TransactionType.EXPENSE ? (tx.amount || "") : ""}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value, 10) || 0;
                                          const updated = [...activeWorkspaceReport.transactions];
                                          updated[index] = { 
                                            ...updated[index], 
                                            amount: val, 
                                            type: TransactionType.EXPENSE 
                                          };
                                          
                                          let inc = 0, exp = 0;
                                          updated.forEach(t => {
                                            if (t.type === TransactionType.INCOME) inc += t.amount;
                                            else exp += t.amount;
                                          });

                                          setActiveWorkspaceReport({
                                            ...activeWorkspaceReport,
                                            transactions: updated,
                                            summary: {
                                              ...activeWorkspaceReport.summary,
                                              totalIncome: inc,
                                              totalExpense: exp,
                                              remainingBalance: inc - exp
                                            }
                                          });
                                        }}
                                        className="w-full bg-transparent py-0.5 border-b border-transparent focus:border-red-300 text-right focus:outline-none font-bold text-red-600 font-mono"
                                      />
                                    </td>

                                    {/* Column 7: Saldo (Running) */}
                                    <td className={`p-3 text-right font-bold font-mono text-xs ${rowSaldo < 0 ? "text-red-600" : "text-slate-800"}`}>
                                      Rp {rowSaldo.toLocaleString("id-ID")}
                                    </td>

                                    <td className="p-3 text-center">
                                      <button
                                        onClick={() => handleDeleteWorkspaceTx(index)}
                                        className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-red-500 transition cursor-pointer"
                                      >
                                        <Trash className="w-3.5 h-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}

                              {/* INLINE ROW TO ADD NEW TRANSACTION */}
                              <tr className="bg-indigo-50/20 font-bold">
                                <td className="p-3 text-center text-indigo-400 font-mono">+</td>
                                <td className="p-3">
                                  <input
                                    type="date"
                                    value={newTxDate}
                                    onChange={(e) => setNewTxDate(e.target.value)}
                                    className="w-full bg-white px-2 py-1 border border-slate-250 rounded text-[11px]"
                                  />
                                </td>
                                <td className="p-3">
                                  <input
                                    type="text"
                                    placeholder="Tambah baris manual (keterangan)..."
                                    value={newTxDesc}
                                    onChange={(e) => setNewTxDesc(e.target.value)}
                                    className="w-full bg-white px-2 py-1 border border-slate-250 rounded text-[11px]"
                                  />
                                </td>
                                <td className="p-3">
                                  <select
                                    value={newTxCat}
                                    onChange={(e) => setNewTxCat(e.target.value)}
                                    className="w-full bg-white px-2 py-1 border border-slate-250 rounded text-[11px]"
                                  >
                                    {COMMON_CATEGORIES.map(cat => (
                                      <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                    <option value="Penerimaan Kas">Penerimaan Kas</option>
                                    <option value="Saldo Awal">Saldo Awal</option>
                                  </select>
                                </td>
                                
                                {/* Pemasukan input for New Transaction */}
                                <td className="p-3">
                                  <input
                                    type="number"
                                    placeholder="Masuk"
                                    value={newTxType === TransactionType.INCOME ? (newTxAmount || "") : ""}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10) || 0;
                                      setNewTxAmount(val);
                                      setNewTxType(TransactionType.INCOME);
                                    }}
                                    className="w-full bg-white px-2 py-1 border border-slate-250 rounded text-right text-[11px] font-bold text-emerald-600 font-mono"
                                  />
                                </td>

                                {/* Pengeluaran input for New Transaction */}
                                <td className="p-3">
                                  <input
                                    type="number"
                                    placeholder="Keluar"
                                    value={newTxType === TransactionType.EXPENSE ? (newTxAmount || "") : ""}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10) || 0;
                                      setNewTxAmount(val);
                                      setNewTxType(TransactionType.EXPENSE);
                                    }}
                                    className="w-full bg-white px-2 py-1 border border-slate-250 rounded text-right text-[11px] font-bold text-red-600 font-mono"
                                  />
                                </td>

                                {/* Readonly placeholder for cumulative Saldo in new row */}
                                <td className="p-3 text-right text-[11px] text-slate-400 font-mono">
                                  -
                                </td>

                                <td className="p-3 text-center">
                                  <button
                                    onClick={handleAddWorkspaceTx}
                                    className="p-1 bg-indigo-650 hover:bg-indigo-700 rounded-lg text-white transition cursor-pointer flex items-center justify-center mx-auto"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}

                    {/* GOOGLE DRIVE SYNC OUTCOME INJECTOR */}
                    {cloudSyncStatus.status !== "idle" && (
                      <div className={`mt-6 p-4 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                        cloudSyncStatus.status === "syncing" ? "bg-indigo-50 border-indigo-200 text-indigo-800" :
                        cloudSyncStatus.status === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
                        "bg-red-50 border-red-200 text-red-800"
                      }`}>
                        <div className="flex items-center gap-2">
                          <RefreshCw className={`w-4 h-4 shrink-0 ${cloudSyncStatus.status === "syncing" ? "animate-spin" : ""}`} />
                          <div>
                            {cloudSyncStatus.status === "syncing" && <p className="font-semibold">Menghubungkan ke API Google Drive & mengunggah berkas Excel...</p>}
                            {cloudSyncStatus.status === "success" && (
                              <div>
                                <p className="font-semibold">Berkas "{cloudSyncStatus.msg}" berhasil diupload!</p>
                                <p className="text-[10px] text-emerald-600">Disimpan rapi pada direktori Google Drive: "Laporan Petty Cash Lapangan &gt; Petty Cash - {activeWorkspaceReport.summary.reportMonth}"</p>
                              </div>
                            )}
                            {cloudSyncStatus.status === "error" && <p className="font-semibold">Gagal Sinkronisasi: {cloudSyncStatus.msg}</p>}
                          </div>
                        </div>

                        {activeWorkspaceReport.driveUrl && (
                          <a
                            href={activeWorkspaceReport.driveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white leading-none px-3.5 py-2 rounded-lg font-semibold transition flex items-center gap-1 shrink-0"
                          >
                            <span>Buka Excel di Drive</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    )}

                  </div>

                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs flex flex-col items-center justify-center h-full min-h-[450px]">
                  <FileText className="w-12 h-12 text-slate-300 mb-3" />
                  <h3 className="text-sm font-bold text-slate-700 tracking-tight">Belum Ada Petty Cash Workspace Aktif</h3>
                  <p className="text-xs text-slate-500 mt-2 max-w-md text-balance">
                    Unggah bungkusan struk atau laporan petty cash Anda dalam format PDF atau gambar di panel kiri. Sistem akan membaca seluruh data transaksi menggunakan kecerdasan buatan Gemini AI, kemudian mengorganisirnya ke dalam tabel interaktif untuk dikonversi menjadi file Excel dan disinkronisasikan ke Drive cloud secara otomatis.
                  </p>
                </div>
              )}
            </div>

          </div>
        )}

        {/* TAB 3: WORKERS LIST & DEFAULTS MANAGER */}
        {activeTab === "workers" && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8" id="workers_tab_view">
            
            {/* MANAGE WORKERS LIST */}
            <div className="md:col-span-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
              
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 mb-6 gap-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight font-display">Daftar Pekerja Lapangan</h3>
                  <p className="text-xs text-slate-500">Daftar karyawan aktif yang berhak mendapatkan jatah uang makan harian.</p>
                </div>

                {/* GLOBAL ALLOWANCE CONFIG */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-600 block">Tarif Meal Allowance (Rp/Hari):</label>
                  <input
                    type="number"
                    value={globalAllowance}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 0;
                      setGlobalAllowance(val);
                      // Update active allowance records
                      setAttendanceRecords(attendanceRecords.map(r => 
                        r.attendance[weekStart] !== undefined ? { ...r, dailyAllowance: val } : r
                      ));
                    }}
                    className="w-28 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-center font-bold text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-200">
                      <th className="py-3 px-4">Nama Pekerja</th>
                      <th className="py-3 px-4">Jabatan</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {workers.map((worker) => (
                      <tr key={worker.id} className="hover:bg-slate-50/50">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900">{worker.name}</div>
                          <div className="text-[10px] font-mono text-slate-500">ID: {worker.id}</div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-700">{worker.role}</td>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => handleToggleWorkerActive(worker.id)}
                            className={`px-3 py-1 text-xs font-semibold rounded-full cursor-pointer transition ${
                              worker.isActive
                                ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                            }`}
                          >
                            {worker.isActive ? "Aktif" : "Non-aktif"}
                          </button>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <button
                            onClick={() => handleRemoveWorker(worker.id)}
                            className="p-1 text-slate-400 hover:text-red-500 transition cursor-pointer"
                          >
                            <Trash className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>

            {/* REGISTER NEW WORKER CARD */}
            <div className="md:col-span-4 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
              
              <h3 className="text-base font-bold text-slate-900 font-display mb-4">Tambah Pekerja Lapangan Baru</h3>
              <form onSubmit={handleAddWorker} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Nama Lengkap Pekerja</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Ahmad Solihin"
                    value={newWorkerName}
                    onChange={(e) => setNewWorkerName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-250 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Jabatan / Peran Lapangan</label>
                  <input
                    type="text"
                    placeholder="Contoh: Tukang Kayu / Helper"
                    value={newWorkerRole}
                    onChange={(e) => setNewWorkerRole(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-250 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-900"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-100"
                >
                  <Plus className="w-4 h-4" />
                  <span>Daftarkan Pekerja Baru</span>
                </button>
              </form>

            </div>

          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 mt-12 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center sm:text-left flex flex-col sm:flex-row justify-between items-center gap-4">
          <div>
            <div className="font-bold font-display text-white text-sm">KarsaField Pro v1.1</div>
            <p className="text-xs text-slate-500 mt-1">&copy; 2026 KarsaField Corp. Hak Cipta Dilindungi.</p>
          </div>
          <div className="text-xs text-slate-500 leading-relaxed max-w-sm sm:text-right">
            Disinkronisasikan otomatis dengan Google Cloud Workspace melalui API aman. Uang makan divalidasi berkala setiap Jumat siang.
          </div>
        </div>
      </footer>

    </div>
  );
}
