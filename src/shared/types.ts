export type TxType = "expense" | "income" | "transfer" | "adjustment";
export type TxSource = "manual" | "email" | "import";
export type TxStatus = "ok" | "review";
export type AccountKind = "bank" | "ewallet" | "cash" | "other";

export const PROVIDERS: { id: string; label: string; kind: AccountKind }[] = [
  { id: "bri", label: "BRI", kind: "bank" },
  { id: "bni", label: "BNI", kind: "bank" },
  { id: "bsi", label: "BSI", kind: "bank" },
  { id: "bca", label: "BCA", kind: "bank" },
  { id: "mandiri", label: "Mandiri", kind: "bank" },
  { id: "gopay", label: "GoPay", kind: "ewallet" },
  { id: "ovo", label: "OVO", kind: "ewallet" },
  { id: "dana", label: "DANA", kind: "ewallet" },
  { id: "shopeepay", label: "ShopeePay", kind: "ewallet" },
  { id: "linkaja", label: "LinkAja", kind: "ewallet" },
  { id: "cash", label: "Tunai", kind: "cash" },
  { id: "other", label: "Lainnya", kind: "other" },
];

export function providerLabel(id: string | null | undefined): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id ?? "";
}

export interface AccountDTO {
  id: number;
  name: string;
  provider: string;
  kind: AccountKind;
  last4: string | null;
  openingBalance: number;
  archived: boolean;
  balance: number;
}

export interface CategoryDTO {
  id: number;
  name: string;
  icon: string;
  kind: "expense" | "income";
  sort: number;
  archived: boolean;
}

export interface RuleDTO {
  id: number;
  pattern: string;
  categoryId: number;
  origin: string;
}

export interface TransactionDTO {
  id: number;
  type: TxType;
  amount: number;
  accountId: number | null;
  toAccountId: number | null;
  categoryId: number | null;
  merchant: string | null;
  description: string | null;
  occurredAt: string;
  source: TxSource;
  status: TxStatus;
  emailId: number | null;
}

export interface MonthSummaryDTO {
  month: string; // YYYY-MM
  expense: number;
  income: number;
  net: number;
  /** pengeluaran bulan lalu sampai tanggal yang sama */
  prevExpenseSamePeriod: number;
  prevExpenseTotal: number;
  /** hari ke berapa dalam bulan (untuk bulan berjalan), atau jumlah hari jika bulan sudah lewat */
  dayOfMonth: number;
  daysInMonth: number;
  isCurrentMonth: boolean;
  byCategory: { categoryId: number | null; total: number; count: number }[];
  incomeByCategory: { categoryId: number | null; total: number; count: number }[];
  daily: number[]; // pengeluaran per tanggal, index 0 = tgl 1
  transferTotal: number;
  budget: number | null;
  budgetRemaining: number | null;
  safePerDay: number | null;
  reviewCount: number;
  unparsedEmailCount: number;
}

export interface InboxEmailDTO {
  id: number;
  provider: string | null;
  fromAddr: string;
  subject: string;
  receivedAt: string;
  status: string;
  note: string | null;
  transactionId: number | null;
  snippet: string;
}

export interface SettingsDTO {
  monthlyBudget: number | null;
  ownerNames: string[];
}

/** Baris mutasi yang sudah dinormalisasi di browser sebelum dikirim ke server. */
export interface ImportRow {
  date: string; // YYYY-MM-DD
  description: string;
  /** negatif = uang keluar, positif = uang masuk */
  amount: number;
}

export interface ImportResultDTO {
  batchId: number;
  inserted: number;
  matched: number;
  skipped: number;
  rows: { index: number; result: "inserted" | "matched" | "skipped"; transactionId: number | null }[];
}
