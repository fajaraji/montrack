import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Rekening bank, e-wallet, atau dompet tunai. */
export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** bri | bni | bsi | gopay | ovo | dana | shopeepay | cash | other */
  provider: text("provider").notNull().default("other"),
  /** bank | ewallet | cash | other */
  kind: text("kind").notNull().default("bank"),
  /** 4 digit terakhir nomor rekening/HP, untuk mencocokkan email. */
  last4: text("last4"),
  openingBalance: bigint("opening_balance", { mode: "number" }).notNull().default(0),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("•"),
  /** expense | income */
  kind: text("kind").notNull().default("expense"),
  sort: integer("sort").notNull().default(100),
  archived: boolean("archived").notNull().default(false),
  /** anggaran bulanan kategori (rupiah), null = tanpa anggaran */
  monthlyBudget: bigint("monthly_budget", { mode: "number" }),
});

/** Kata kunci merchant/deskripsi → kategori. */
export const categoryRules = pgTable(
  "category_rules",
  {
    id: serial("id").primaryKey(),
    /** huruf kecil, dicocokkan sebagai substring dari merchant/deskripsi */
    pattern: text("pattern").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    /** seed | learned | manual */
    origin: text("origin").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("category_rules_pattern_idx").on(t.pattern)],
);

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  filename: text("filename"),
  rowCount: integer("row_count").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  matched: integer("matched").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Email bukti bayar yang dikirim oleh Google Apps Script. */
export const inboxEmails = pgTable(
  "inbox_emails",
  {
    id: serial("id").primaryKey(),
    messageId: text("message_id").notNull(),
    provider: text("provider"),
    fromAddr: text("from_addr").notNull().default(""),
    subject: text("subject").notNull().default(""),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    body: text("body").notNull().default(""),
    /** parsed | unparsed | ignored | merged */
    status: text("status").notNull().default("unparsed"),
    note: text("note"),
    transactionId: integer("transaction_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inbox_emails_message_id_idx").on(t.messageId)],
);

/**
 * type:
 *  - expense    : uang keluar untuk belanja/bayar (masuk hitungan "pengeluaran bulan ini")
 *  - income     : uang masuk dari luar (gaji, refund, dsb.)
 *  - transfer   : pindah uang antar akun sendiri (top-up e-wallet, tarik tunai, dsb.)
 *                 accountId = asal (boleh null: tidak diketahui), toAccountId = tujuan
 *  - adjustment : koreksi saldo; amount bertanda (+/-), tidak dihitung sebagai pengeluaran/pemasukan
 * amount selalu positif kecuali adjustment.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
    toAccountId: integer("to_account_id").references(() => accounts.id, { onDelete: "set null" }),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    merchant: text("merchant"),
    description: text("description"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** manual | email | import */
    source: text("source").notNull().default("manual"),
    /** ok | review */
    status: text("status").notNull().default("ok"),
    emailId: integer("email_id"),
    importBatchId: integer("import_batch_id"),
    /** kunci unik untuk mencegah duplikat dari sumber otomatis */
    fingerprint: text("fingerprint"),
    /** nama merchant asli sebelum diganti nama oleh aturan */
    rawMerchant: text("raw_merchant"),
    /** tidak dihitung di ringkasan/laporan/anggaran (saldo tetap dihitung) */
    excluded: boolean("excluded").notNull().default(false),
    /** id transaksi asal bila transaksi ini hasil "bagi transaksi" */
    splitGroupId: integer("split_group_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_occurred_at_idx").on(t.occurredAt),
    index("transactions_account_idx").on(t.accountId),
    uniqueIndex("transactions_fingerprint_idx").on(t.fingerprint),
  ],
);

/** Sidik jari tiap baris mutasi yang pernah diimpor, agar impor ulang tidak dobel. */
export const importRows = pgTable(
  "import_rows",
  {
    id: serial("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    batchId: integer("batch_id").notNull(),
    /** inserted | matched */
    result: text("result").notNull(),
    transactionId: integer("transaction_id"),
  },
  (t) => [uniqueIndex("import_rows_fingerprint_idx").on(t.fingerprint)],
);

/** Ganti nama merchant: pola (huruf kecil, substring) → nama tampilan. */
export const merchantRenames = pgTable(
  "merchant_renames",
  {
    id: serial("id").primaryKey(),
    pattern: text("pattern").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("merchant_renames_pattern_idx").on(t.pattern)],
);

/** Target tabungan. Progres = saldo akun tertaut, atau jumlah setoran manual. */
export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon").notNull().default("🎯"),
  target: bigint("target", { mode: "number" }).notNull(),
  saved: bigint("saved", { mode: "number" }).notNull().default(0),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  /** YYYY-MM-DD */
  deadline: text("deadline"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    endpoint: text("endpoint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint)],
);

/** Notifikasi di dalam aplikasi (juga isi untuk Web Push). */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  /** recap | budget | bill */
  kind: text("kind").notNull(),
  /** kunci unik agar notifikasi yang sama tidak terkirim dua kali */
  dedupeKey: text("dedupe_key").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url").notNull().default("/"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Biaya tetap bulanan (mis. admin rekening) yang dicatat otomatis. Bisa diubah kapan saja. */
export const recurringFees = pgTable("recurring_fees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  /** tanggal 1–31 (bulan yang lebih pendek memakai tanggal terakhirnya) */
  dayOfMonth: integer("day_of_month").notNull(),
  /** YYYY-MM: bulan pertama yang dicatat */
  startMonth: text("start_month").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type CategoryRule = typeof categoryRules.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type InboxEmail = typeof inboxEmails.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type RecurringFee = typeof recurringFees.$inferSelect;
