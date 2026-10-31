import { sql } from "drizzle-orm";
import type { DB } from "./client";
import { categories, categoryRules } from "./schema";

export const DEFAULT_CATEGORIES: { name: string; icon: string; kind: "expense" | "income" }[] = [
  { name: "Makan & Minum", icon: "🍜", kind: "expense" },
  { name: "Kopi & Jajan", icon: "☕", kind: "expense" },
  { name: "Belanja Harian", icon: "🛒", kind: "expense" },
  { name: "Transportasi", icon: "🛵", kind: "expense" },
  { name: "Bensin & Parkir", icon: "⛽", kind: "expense" },
  { name: "Belanja Online", icon: "📦", kind: "expense" },
  { name: "Tagihan & Utilitas", icon: "🧾", kind: "expense" },
  { name: "Pulsa & Internet", icon: "📱", kind: "expense" },
  { name: "Langganan", icon: "🎬", kind: "expense" },
  { name: "Kesehatan", icon: "💊", kind: "expense" },
  { name: "Hiburan", icon: "🎮", kind: "expense" },
  { name: "Pendidikan", icon: "📚", kind: "expense" },
  { name: "Rumah Tangga", icon: "🏠", kind: "expense" },
  { name: "Pakaian & Perawatan", icon: "👕", kind: "expense" },
  { name: "Sosial & Donasi", icon: "🤝", kind: "expense" },
  { name: "Biaya Bank & Admin", icon: "🏦", kind: "expense" },
  { name: "Transfer ke Orang Lain", icon: "↗️", kind: "expense" },
  { name: "Lainnya", icon: "•", kind: "expense" },
  { name: "Gaji", icon: "💼", kind: "income" },
  { name: "Bonus", icon: "🎁", kind: "income" },
  { name: "Freelance", icon: "💻", kind: "income" },
  { name: "Refund & Cashback", icon: "↩️", kind: "income" },
  { name: "Bunga Bank", icon: "💰", kind: "income" },
  { name: "Transfer Masuk", icon: "↙️", kind: "income" },
  { name: "Pemasukan Lain", icon: "➕", kind: "income" },
];

/** Kata kunci merchant Indonesia yang umum → nama kategori. */
export const DEFAULT_RULES: Record<string, string[]> = {
  "Makan & Minum": [
    "gofood", "grabfood", "shopeefood", "mcdonald", "mcd ", "kfc", "burger king", "pizza hut", "hokben",
    "solaria", "richeese", "warteg", "warung", "nasi ", "bakso", "mie ", "ayam ", "sate ", "soto ",
    "padang", "rm ", "resto", "restoran", "rumah makan", "bebek", "seblak", "martabak", "geprek", "dimsum",
  ],
  "Kopi & Jajan": [
    "kopi", "coffee", "starbucks", "janji jiwa", "kenangan", "fore ", "tomoro", "point coffee", "chatime",
    "mixue", "es teh", "haus!", "roti", "bakery", "jco", "dunkin", "cafe", "kafe",
  ],
  "Belanja Harian": [
    "indomaret", "alfamart", "alfamidi", "superindo", "hypermart", "transmart", "lotte mart", "giant",
    "hero ", "lawson", "familymart", "circle k", "minimarket", "sayur", "pasar", "toko kelontong",
  ],
  Transportasi: [
    "gojek", "goride", "gocar", "grab", "maxim", "indrive", "krl", "commuter", "mrt", "lrt", "transjakarta",
    "kai ", "kereta", "damri", "bluebird", "taksi", "ojek",
  ],
  "Bensin & Parkir": ["pertamina", "spbu", "shell", "bp-akr", "vivo energy", "parkir", "parking", "e-toll", "tol "],
  "Belanja Online": ["tokopedia", "shopee", "lazada", "blibli", "bukalapak", "tiktok shop", "zalora", "amazon"],
  "Tagihan & Utilitas": ["pln", "token listrik", "listrik", "pdam", "air bersih", "bpjs", "pbb", "iuran", "angsuran", "cicilan"],
  "Pulsa & Internet": ["pulsa", "paket data", "telkomsel", "indosat", "xl ", "axis", "smartfren", "tri ", "indihome", "biznet", "first media", "myrepublic", "wifi"],
  Langganan: ["netflix", "spotify", "youtube", "google one", "icloud", "apple.com", "disney", "vidio", "prime video", "chatgpt", "openai", "canva", "microsoft"],
  Kesehatan: ["apotek", "apotik", "kimia farma", "k24", "guardian", "watsons", "klinik", "rumah sakit", "rs ", "dokter", "halodoc", "alodokter", "lab "],
  Hiburan: ["bioskop", "cgv", "xxi", "cinepolis", "steam", "playstation", "game", "karaoke", "tiket.com", "loket"],
  Pendidikan: ["sekolah", "kursus", "udemy", "coursera", "buku", "gramedia", "spp", "kampus", "universitas"],
  "Rumah Tangga": ["ace hardware", "ikea", "informa", "mr diy", "laundry", "gas lpg", "galon"],
  "Pakaian & Perawatan": ["uniqlo", "h&m", "zara", "matahari", "barbershop", "salon", "sociolla", "skincare"],
  "Sosial & Donasi": ["kitabisa", "donasi", "zakat", "infaq", "sedekah", "baznas", "dompet dhuafa"],
  "Biaya Bank & Admin": ["biaya adm", "biaya admin", "adm bulanan", "biaya kartu", "biaya transfer", "admin fee", "pajak bunga", "materai", "bi-fast fee"],
  Gaji: ["gaji", "payroll", "salary"],
  "Refund & Cashback": ["refund", "cashback", "pengembalian dana"],
  "Bunga Bank": ["bunga", "interest"],
};

/** Idempoten: hanya mengisi kategori & aturan jika tabel masih kosong. */
export async function seedDefaults(db: DB): Promise<void> {
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(categories);
  if ((existing[0]?.n ?? 0) > 0) return;

  const inserted = await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sort: i * 10 })))
    .returning({ id: categories.id, name: categories.name });
  const byName = new Map(inserted.map((c) => [c.name, c.id]));

  const rules = Object.entries(DEFAULT_RULES).flatMap(([cat, patterns]) =>
    patterns.map((pattern) => ({ pattern, categoryId: byName.get(cat)!, origin: "seed" as const })),
  );
  await db.insert(categoryRules).values(rules).onConflictDoNothing();
}
