/**
 * Extract plain text from an uploaded writing sample. Supports .md/.txt/.markdown
 * directly, and .docx/.pdf via dynamically-imported parsers (mammoth / pdfjs-dist)
 * so those heavy deps stay out of the initial bundle. Client-side only.
 */

export const SAMPLE_ACCEPT = ".md,.txt,.markdown,.docx,.pdf";

/** Ceiling on a single heavy parse (docx/pdf) so a hung worker can't leave the
 * uploader stuck on "Reading…" forever with no error. */
const PARSE_TIMEOUT_MS = 20000;

function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out. Try a smaller or simpler file.`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value ?? "";
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Point the worker at the bundled asset; the bundler rewrites this URL.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
  // finally wraps the getDocument await too, so a rejected/failed worker load
  // still tears the task down (was leaking on that path before).
  try {
    const doc = await loadingTask.promise;
    const parts: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      parts.push(pageText);
    }
    return parts.join("\n\n");
  } finally {
    await loadingTask.destroy();
  }
}

export interface ExtractedSample {
  title: string;
  text: string;
}

/**
 * Extract text from a sample file. Throws with a user-facing message on an
 * unsupported type or a parse failure, so callers can toast it.
 */
export async function extractSampleText(file: File): Promise<ExtractedSample> {
  const ext = extension(file.name);
  const title = file.name.replace(/\.[^.]+$/, "") || file.name;

  let text: string;
  switch (ext) {
    case "md":
    case "markdown":
    case "txt":
      text = await readAsText(file);
      break;
    case "docx":
      text = await withTimeout(extractDocx(file), PARSE_TIMEOUT_MS, "Reading that document");
      break;
    case "pdf":
      text = await withTimeout(extractPdf(file), PARSE_TIMEOUT_MS, "Reading that PDF");
      break;
    default:
      throw new Error(`Unsupported file type: .${ext || "unknown"}`);
  }

  const trimmed = text.trim();
  if (!trimmed) throw new Error("No text found in that file.");
  return { title, text: trimmed };
}
