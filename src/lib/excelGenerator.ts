import * as XLSX from "xlsx";
import { PettyCashTransaction, PettyCashSummary } from "../types";

export function generatePettyCashExcelBlob(
  transactions: PettyCashTransaction[],
  summary: PettyCashSummary
): Blob {
  // Format data for sheet Row structure
  const rows = transactions.map((t, idx) => ({
    "No.": idx + 1,
    Tanggal: t.date,
    Karyawan: t.worker || summary.workerName || "Pekerja Lapangan",
    Keterangan: t.description,
    Kategori: t.category,
    Tipe: t.type === "EXPENSE" ? "Pengeluaran (Out)" : "Pemasukan (In)",
    Jumlah: t.amount,
  }));

  // Create sheet
  const ws = XLSX.utils.json_to_sheet(rows);

  // Set column widths
  const maxCols = [
    { wch: 6 },  // No
    { wch: 15 }, // Tanggal
    { wch: 20 }, // Karyawan
    { wch: 40 }, // Keterangan
    { wch: 20 }, // Kategori
    { wch: 20 }, // Tipe
    { wch: 15 }, // Jumlah
  ];
  ws["!cols"] = maxCols;

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Laporan Petty Cash");

  // Create metadata / summary sheet
  const summaryRows = [
    ["LAPORAN PETTY CASH LAPANGAN", ""],
    ["", ""],
    ["Bulan / Periode:", summary.reportMonth],
    ["Nama Pekerja:", summary.workerName || "-"],
    ["", ""],
    ["TOTAL PENERIMAAN:", summary.totalIncome],
    ["TOTAL PENGELUARAN:", summary.totalExpense],
    ["SISA SALDO:", summary.remainingBalance],
    ["Dibuat Tanggal:", new Date().toLocaleDateString("id-ID")],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary["!cols"] = [{ wch: 25 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan Laporan");

  // Write file as binary buffer
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  
  // Return blob
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function triggerExcelDownload(
  transactions: PettyCashTransaction[],
  summary: PettyCashSummary,
  fileName: string = "Laporan_Petty_Cash.xlsx"
) {
  const blob = generatePettyCashExcelBlob(transactions, summary);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
