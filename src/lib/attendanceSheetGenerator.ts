import * as XLSX from "xlsx";
import { AttendanceRecord, Worker, WeeklyReport } from "../types";

export function printWeeklyReportPDF(report: WeeklyReport, workers: Worker[]) {
  const getDates = (): string[] => {
    const dates: string[] = [];
    const current = new Date(report.weekStartDate);
    for (let i = 0; i < 5; i++) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  const dates = getDates();
  const dayNames = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];
  const workerMap = new Map(workers.map((w) => [w.id, w]));

  const totalCost = report.records.reduce((sum, r) => {
    const presentDays = Object.values(r.attendance).filter(status => status).length;
    return sum + (presentDays * r.dailyAllowance);
  }, 0);

  const tableRows = report.records.map((record, index) => {
    const worker = workerMap.get(record.workerId);
    let totalAttendance = 0;
    
    const dayCells = dates.map((date) => {
      const isPresent = record.attendance[date] || false;
      if (isPresent) totalAttendance++;
      return `<td class="text-center font-bold" style="color: ${isPresent ? '#16a34a' : '#94a3b8'};">${isPresent ? "Hadir" : "-"}</td>`;
    }).join("");

    const totalAllowance = totalAttendance * record.dailyAllowance;

    // Alternate signature position for authentic look (Odd rows on the left, Even rows on the right)
    const signatureContent = index % 2 === 0 
      ? `<div style="text-align: left; padding-left: 10px; font-size: 8px; font-weight: bold; color: #475569;">${index + 1}. .......................</div>`
      : `<div style="text-align: right; padding-right: 10px; font-size: 8px; font-weight: bold; color: #475569;">${index + 1}. .......................</div>`;

    return `
      <tr>
        <td class="text-center font-mono" style="color: #64748b;">${index + 1}</td>
        <td>
          <div style="font-weight: bold; color: #0f172a;">${worker?.name || "Karyawan Tidak Dikenal"}</div>
          <div style="font-size: 8px; color: #64748b;">${worker?.role || "-"}</div>
        </td>
        ${dayCells}
        <td class="text-center font-bold" style="background-color: #f8fafc;">${totalAttendance} Hari</td>
        <td class="text-right font-mono">Rp ${record.dailyAllowance.toLocaleString("id-ID")}</td>
        <td class="text-right font-mono font-bold" style="background-color: #f8fafc;">Rp ${totalAllowance.toLocaleString("id-ID")}</td>
        <td style="width: 140px; vertical-align: middle; padding: 4px; background-color: #fff;">
          ${signatureContent}
        </td>
      </tr>
    `;
  }).join("");

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Gagal membuka jendela cetak. Pastikan pop-up browser tidak diblokir.");
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>Rekap Uang Makan Mingguan - ${report.weekStartDate}</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 12mm;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #1e293b;
            padding: 0;
            margin: 0;
            font-size: 10px;
            line-height: 1.4;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 15px;
            margin-bottom: 20px;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 12px;
            text-align: left;
          }
          .logo {
            height: 52px;
            width: auto;
            object-fit: contain;
          }
          .header-text {
            flex-grow: 1;
          }
          .header h1 {
            margin: 0 0 2px 0;
            font-size: 14px;
            color: #1e3a8a;
            font-weight: 800;
            letter-spacing: 0.5px;
          }
          .header h2 {
            margin: 0 0 4px 0;
            font-size: 12px;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .header p {
            margin: 0;
            font-size: 9px;
            color: #475569;
          }
          .meta-container {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
          }
          .meta-table {
            border-collapse: collapse;
          }
          .meta-table td {
            padding: 3px 0;
            font-size: 10px;
          }
          .meta-label {
            font-weight: bold;
            width: 150px;
            color: #475569;
          }
          .meta-value {
            color: #0f172a;
          }
          .report-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 25px;
          }
          .report-table th {
            background-color: #f1f5f9;
            border: 1px solid #cbd5e1;
            padding: 6px 4px;
            font-weight: bold;
            font-size: 9px;
            text-transform: uppercase;
            color: #334155;
          }
          .report-table td {
            border: 1px solid #cbd5e1;
            padding: 6px 6px;
            font-size: 9px;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .font-bold { font-weight: bold; }
          
          .signature-container {
            display: flex;
            justify-content: space-between;
            margin-top: 30px;
            page-break-inside: avoid;
          }
          .signature-box {
            width: 250px;
            text-align: center;
          }
          .signature-title {
            font-size: 10px;
            margin-bottom: 55px;
            color: #334155;
          }
          .signature-name {
            font-weight: bold;
            font-size: 10px;
            color: #0f172a;
            border-bottom: 1px solid #000;
            display: inline-block;
            padding: 0 15px;
          }
          .signature-role {
            font-size: 9px;
            color: #64748b;
            margin-top: 3px;
          }
          
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="https://i.ibb.co.com/FqDNnD8W/Logo-Nusantara-Mineral-Abadi.webp" alt="Logo PT" class="logo" />
          <div class="header-text">
            <h1>PT. NUSANTARA MINERAL SUKSES ABADI</h1>
            <h2>Laporan Absensi & Uang Makan Mingguan Karyawan</h2>
            <p>Dokumen Rekap Lapangan Terverifikasi</p>
          </div>
        </div>
        
        <div class="meta-container">
          <table class="meta-table">
            <tr>
              <td class="meta-label">Periode Mingguan</td>
              <td class="meta-value">: &nbsp; <strong>${report.weekStartDate} s/d ${report.weekEndDate}</strong></td>
            </tr>
            <tr>
              <td class="meta-label">Jumlah Pekerja Aktif</td>
              <td class="meta-value">: &nbsp; ${report.records.length} Orang</td>
            </tr>
            <tr>
              <td class="meta-label">Hari Operasional</td>
              <td class="meta-value">: &nbsp; Senin - Jumat</td>
            </tr>
          </table>
          
          <table class="meta-table">
            <tr>
              <td class="meta-label">Total Pengeluaran Uang Makan</td>
              <td class="meta-value" style="font-size: 11px;">: &nbsp; <strong style="color: #0f172a;">Rp ${totalCost.toLocaleString("id-ID")}</strong></td>
            </tr>
            <tr>
              <td class="meta-label">Tanggal Cetak</td>
              <td class="meta-value">: &nbsp; ${new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</td>
            </tr>
          </table>
        </div>
        
        <table class="report-table">
          <thead>
            <tr>
              <th style="width: 30px;" class="text-center">No</th>
              <th style="width: 150px;">Nama Pekerja / Jabatan</th>
              <th style="width: 50px;" class="text-center">Senin</th>
              <th style="width: 50px;" class="text-center">Selasa</th>
              <th style="width: 50px;" class="text-center">Rabu</th>
              <th style="width: 50px;" class="text-center">Kamis</th>
              <th style="width: 50px;" class="text-center">Jumat</th>
              <th style="width: 65px;" class="text-center">Total Hadir</th>
              <th style="width: 90px;" class="text-right">Tarif (Rp/Hari)</th>
              <th style="width: 100px;" class="text-right">Total Uang Makan</th>
              <th style="width: 150px;" class="text-center">Paraf Penerima (Karyawan)</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        
        <div class="signature-container">
          <div class="signature-box">
            <div class="signature-title">Diterima & Diperiksa Oleh,</div>
            <div class="signature-name" style="text-decoration: none; border-bottom: 1.5px solid #000; padding-bottom: 2px;">Andi Dhiya Salsabila</div>
            <div class="signature-role">Keuangan</div>
          </div>
          <div class="signature-box">
            <div class="signature-title">Diserahkan & Dilaporkan Oleh,</div>
            <div class="signature-name" style="text-decoration: none; border-bottom: 1.5px solid #000; padding-bottom: 2px;">Nur Wahyudi</div>
            <div class="signature-role">Staff Keuangan</div>
          </div>
        </div>
        
        <script>
          // Run print on load
          window.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
              window.print();
            }, 500);
          });
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

export function generateAttendanceExcelBlob(
  weekStartDate: string,
  weekEndDate: string,
  records: AttendanceRecord[],
  workers: Worker[]
): Blob {
  // Extract dates in range (Mon-Fri)
  const getDates = (): string[] => {
    const dates: string[] = [];
    const current = new Date(weekStartDate);
    for (let i = 0; i < 5; i++) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  const dates = getDates();
  const dayNames = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];

  // Helper mapping
  const workerMap = new Map(workers.map((w) => [w.id, w]));

  const rows = records.map((record, index) => {
    const worker = workerMap.get(record.workerId);
    const row: any = {
      "No.": index + 1,
      Karyawan: worker?.name || "Karyawan Tidak Dikenal",
      Jabatan: worker?.role || "-",
    };

    let totalAttendance = 0;
    dates.forEach((date, dIdx) => {
      const isPresent = record.attendance[date] || false;
      row[dayNames[dIdx]] = isPresent ? "Hadir" : "Absen";
      if (isPresent) totalAttendance++;
    });

    row["Total Kehadiran"] = totalAttendance;
    row["Tarif Uang Makan (Harian)"] = record.dailyAllowance;
    row["Total Uang Makan (Mingguan)"] = totalAttendance * record.dailyAllowance;

    return row;
  });

  // Create sheet
  const ws = XLSX.utils.json_to_sheet(rows);

  ws["!cols"] = [
    { wch: 6 },   // No
    { wch: 25 },  // Karyawan
    { wch: 20 },  // Jabatan
    { wch: 12 },  // Senin
    { wch: 12 },  // Selasa
    { wch: 12 },  // Rabu
    { wch: 12 },  // Kamis
    { wch: 12 },  // Jumat
    { wch: 15 },  // Total Kehadiran
    { wch: 25 },  // Tarif
    { wch: 25 },  // Total
  ];

  // Create Workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rekap Uang Makan");

  // Title sheet
  const titleData = [
    ["LAPORAN ABSENSI & UANG MAKAN HARIAN", ""],
    ["Periode Mingguan:", `${weekStartDate} s/d ${weekEndDate}`],
    ["Jumlah Pekerja:", records.length],
    ["Total Pengeluaran Uang Makan:", records.reduce((sum, r) => {
      const presentDays = Object.values(r.attendance).filter(status => status).length;
      return sum + (presentDays * r.dailyAllowance);
    }, 0)],
    ["Status Laporan:", "Dilaporkan hari Jumat"],
    ["Dibuat Pada:", new Date().toLocaleDateString("id-ID")],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(titleData);
  wsSummary["!cols"] = [{ wch: 28 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan Absensi");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function triggerAttendanceExcelDownload(
  weekStartDate: string,
  weekEndDate: string,
  records: AttendanceRecord[],
  workers: Worker[],
  fileName: string = "Rekap_Uang_Makan_Mingguan.xlsx"
) {
  const blob = generateAttendanceExcelBlob(weekStartDate, weekEndDate, records, workers);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
