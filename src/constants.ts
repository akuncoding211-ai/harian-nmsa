import { Worker } from "./types";

export const INITIAL_WORKERS: Worker[] = [
  { id: "W01", name: "Ahmad Solihin", role: "Tukang Kayu", isActive: true },
  { id: "W02", name: "Bambang Wijaya", role: "Mandor Lapangan", isActive: true },
  { id: "W03", name: "Dedi Kusnadi", role: "Pekerja Sipil", isActive: true },
  { id: "W04", name: "Eko Prasetyo", role: "Operator Alat Berat", isActive: true },
  { id: "W05", name: "Feri Setiawan", role: "Asisten Mandor", isActive: true },
  { id: "W06", name: "Guntur Saputra", role: "Pekerja Listrik & Utilitas", isActive: true },
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
