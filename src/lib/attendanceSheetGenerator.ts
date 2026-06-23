import * as XLSX from "xlsx";
import { AttendanceRecord, Worker } from "../types";

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
