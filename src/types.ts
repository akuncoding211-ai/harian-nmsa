export enum TransactionType {
  EXPENSE = "EXPENSE",
  INCOME = "INCOME",
}

export interface Worker {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  bankName?: string;
  bankAccount?: string;
  phoneNumber?: string;
  nik?: string;
  photoUrl?: string;
}

export interface DailyAttendance {
  date: string; // YYYY-MM-DD
  isPresent: boolean;
  notes?: string;
}

export interface AttendanceRecord {
  workerId: string;
  attendance: { [date: string]: boolean }; // date -> present status
  dailyAllowance: number; // e.g. Rp 50.000
}

export interface WeeklyReport {
  id: string;
  weekStartDate: string; // Monday
  weekEndDate: string; // Friday
  records: AttendanceRecord[];
  isSubmitted: boolean;
  submittedAt?: string;
  sheetsUrl?: string; // If exported to Google Sheets
}

export interface PettyCashTransaction {
  date: string;
  description: string;
  category: string;
  amount: number;
  worker: string;
  type: TransactionType;
}

export interface PettyCashSummary {
  totalIncome: number;
  totalExpense: number;
  remainingBalance: number;
  workerName: string;
  reportMonth: string;
}

export interface PettyCashReport {
  id: string;
  fileName: string;
  uploadedAt: string;
  summary: PettyCashSummary;
  transactions: PettyCashTransaction[];
  driveFileId?: string; // If saved to Google Drive
  driveUrl?: string;
}
