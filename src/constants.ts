import { Worker } from "./types";

export const INITIAL_WORKERS: Worker[] = [
  { id: "W01", name: "Ahmad Solihin", role: "Tukang Kayu", isActive: true, bankName: "BCA", bankAccount: "8830129481", phoneNumber: "081234567890", nik: "3273012304910001" },
  { id: "W02", name: "Bambang Wijaya", role: "Mandor Lapangan", isActive: true, bankName: "Mandiri", bankAccount: "131002934812", phoneNumber: "081398765432", nik: "3273011211850003" },
  { id: "W03", name: "Dedi Kusnadi", role: "Pekerja Sipil", isActive: true, bankName: "BRI", bankAccount: "0029012345678", phoneNumber: "082155443322", nik: "3273010502930002" },
  { id: "W04", name: "Eko Prasetyo", role: "Operator Alat Berat", isActive: true, bankName: "BNI", bankAccount: "0219482938", phoneNumber: "085299887766", nik: "3273011408890004" },
  { id: "W05", name: "Feri Setiawan", role: "Asisten Mandor", isActive: true, bankName: "BCA", bankAccount: "8830948211", phoneNumber: "087711223344", nik: "3273012305940001" },
  { id: "W06", name: "Guntur Saputra", role: "Pekerja Listrik & Utilitas", isActive: true, bankName: "Mandiri", bankAccount: "131004829103", phoneNumber: "089622334455", nik: "3273011710920005" },
];

export const INDONESIAN_DAYS = {
  Monday: "Senin",
  Tuesday: "Selasa",
  Wednesday: "Rabu",
  Thursday: "Kamis",
  Friday: "Jumat",
};

export const COMMON_CATEGORIES = [
  "Material",
  "Transport",
  "Konsumsi",
  "Tools",
  "Keamanan / Koordinasi",
  "Lain-lain",
];
