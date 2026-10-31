import type { TextItem } from "../../shared/statement";

export class PdfPasswordError extends Error {
  constructor(public wrong: boolean) {
    super(wrong ? "Password PDF salah" : "PDF ini dilindungi password");
  }
}

/** Ekstrak potongan teks beserta posisinya dari PDF (dijalankan di browser, file tidak diunggah). */
export async function extractPdfItems(file: File, password?: string): Promise<TextItem[]> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, password });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err?.name === "PasswordException") {
      throw new PdfPasswordError(err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
    }
    throw e;
  }
  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], page: p });
    }
  }
  await task.destroy();
  return items;
}
