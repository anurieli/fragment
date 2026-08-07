import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ExternalHyperlink,
} from "docx";

type TiptapMark = { type: string; attrs?: Record<string, unknown> };

type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
};

function textRunsFromInline(nodes: TiptapNode[]): (TextRun | ExternalHyperlink)[] {
  const result: (TextRun | ExternalHyperlink)[] = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      result.push(new TextRun({ break: 1 }));
      continue;
    }
    if (node.type !== "text" || !node.text) continue;

    const marks = node.marks ?? [];
    const bold = marks.some((m) => m.type === "bold");
    const italics = marks.some((m) => m.type === "italic");
    const strike = marks.some((m) => m.type === "strike");
    const underline = marks.some((m) => m.type === "underline");
    const code = marks.some((m) => m.type === "code");
    const linkMark = marks.find((m) => m.type === "link");

    const run = new TextRun({
      text: node.text,
      bold,
      italics,
      strike,
      underline: underline ? {} : undefined,
      font: code ? "Courier New" : undefined,
      size: code ? 18 : undefined,
    });

    if (linkMark?.attrs?.href) {
      result.push(
        new ExternalHyperlink({
          link: String(linkMark.attrs.href),
          children: [run],
        })
      );
    } else {
      result.push(run);
    }
  }
  return result;
}

function tiptapNodeToParagraphs(node: TiptapNode): Paragraph[] {
  switch (node.type) {
    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const headingMap: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      return [
        new Paragraph({
          heading: headingMap[level] ?? HeadingLevel.HEADING_1,
          children: textRunsFromInline(node.content ?? []),
        }),
      ];
    }

    case "paragraph": {
      return [new Paragraph({ children: textRunsFromInline(node.content ?? []) })];
    }

    case "blockquote": {
      return (node.content ?? []).flatMap((inner) => {
        if (inner.type !== "paragraph") return tiptapNodeToParagraphs(inner);
        return [
          new Paragraph({
            children: textRunsFromInline(inner.content ?? []),
            indent: { left: 720 },
            border: {
              left: { style: "single", size: 12, color: "F0C446", space: 12 },
            },
          }),
        ];
      });
    }

    case "codeBlock": {
      const text = (node.content ?? [])
        .filter((n) => n.type === "text")
        .map((n) => n.text ?? "")
        .join("");
      return [
        new Paragraph({
          children: [new TextRun({ text, font: "Courier New", size: 18 })],
          shading: { fill: "F5F5F0" },
        }),
      ];
    }

    case "bulletList": {
      return (node.content ?? []).flatMap((item, _i) => {
        const para = item.content?.[0];
        if (!para) return [];
        const children = textRunsFromInline(para.content ?? []);
        return [
          new Paragraph({
            children: [new TextRun({ text: "• " }), ...children],
            indent: { left: 720 },
          }),
          ...(item.content?.slice(1) ?? []).flatMap((n) =>
            tiptapNodeToParagraphs(n)
          ),
        ];
      });
    }

    case "orderedList": {
      return (node.content ?? []).flatMap((item, i) => {
        const para = item.content?.[0];
        if (!para) return [];
        const children = textRunsFromInline(para.content ?? []);
        return [
          new Paragraph({
            children: [new TextRun({ text: `${i + 1}. ` }), ...children],
            indent: { left: 720 },
          }),
          ...(item.content?.slice(1) ?? []).flatMap((n) =>
            tiptapNodeToParagraphs(n)
          ),
        ];
      });
    }

    case "horizontalRule": {
      return [
        new Paragraph({
          children: [],
          border: { bottom: { style: "single", size: 6, color: "CCCCCC", space: 6 } },
        }),
      ];
    }

    default:
      return [];
  }
}

function sanitizeFilename(title: string): string {
  const name = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return name || "untitled";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function copyAsMarkdown(content: string): Promise<void> {
  await navigator.clipboard.writeText(content);
}

export async function copyAsHtml(html: string): Promise<void> {
  const blob = new Blob([html], { type: "text/html" });
  const textBlob = new Blob([html], { type: "text/plain" });
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": blob,
      "text/plain": textBlob,
    }),
  ]);
}

/** Prefer the editor's per-keystroke snapshot over the debounced note store
 * when exporting the note currently open in the editor. */
export function latestNoteContentForExport(
  noteId: string,
  savedContent: string,
  liveEditorNoteId: string | null,
  liveEditorContent: string | null,
): string {
  return liveEditorNoteId === noteId && typeof liveEditorContent === "string"
    ? liveEditorContent
    : savedContent;
}

export function downloadAsMarkdown(content: string, title: string): string {
  const filename = sanitizeFilename(title) + ".md";
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  triggerDownload(blob, filename);
  return filename;
}

export async function downloadAsPdf(
  html: string,
  title: string
): Promise<string> {
  const html2pdf = (await import("html2pdf.js")).default;
  const filename = sanitizeFilename(title) + ".pdf";

  const container = document.createElement("div");
  container.innerHTML = html;
  container.style.cssText = `
    font-family: Georgia, serif;
    font-size: 12pt;
    line-height: 1.75;
    color: #1a1a18;
    padding: 0;
  `;

  // Style headings, blockquotes, code blocks
  container.querySelectorAll("h1").forEach((el) => {
    (el as HTMLElement).style.fontFamily = "Georgia, serif";
    (el as HTMLElement).style.fontSize = "28pt";
    (el as HTMLElement).style.fontWeight = "700";
    (el as HTMLElement).style.lineHeight = "1.3";
    (el as HTMLElement).style.margin = "1.5rem 0 0.75rem";
  });
  container.querySelectorAll("h2").forEach((el) => {
    (el as HTMLElement).style.fontFamily = "Georgia, serif";
    (el as HTMLElement).style.fontSize = "22pt";
    (el as HTMLElement).style.fontWeight = "700";
    (el as HTMLElement).style.lineHeight = "1.3";
    (el as HTMLElement).style.margin = "1.2rem 0 0.6rem";
  });
  container.querySelectorAll("h3").forEach((el) => {
    (el as HTMLElement).style.fontFamily = "Georgia, serif";
    (el as HTMLElement).style.fontSize = "17pt";
    (el as HTMLElement).style.fontWeight = "600";
    (el as HTMLElement).style.lineHeight = "1.3";
    (el as HTMLElement).style.margin = "1rem 0 0.5rem";
  });
  container.querySelectorAll("blockquote").forEach((el) => {
    (el as HTMLElement).style.borderLeft = "3px solid #b08a00";
    (el as HTMLElement).style.paddingLeft = "1rem";
    (el as HTMLElement).style.color = "#555";
  });
  container.querySelectorAll("code").forEach((el) => {
    (el as HTMLElement).style.fontFamily = "monospace";
    (el as HTMLElement).style.background = "#f4f3ee";
    (el as HTMLElement).style.padding = "0.15em 0.4em";
    (el as HTMLElement).style.borderRadius = "3px";
    (el as HTMLElement).style.fontSize = "10pt";
  });
  container.querySelectorAll("pre").forEach((el) => {
    (el as HTMLElement).style.background = "#f4f3ee";
    (el as HTMLElement).style.padding = "0.85rem 1rem";
    (el as HTMLElement).style.borderRadius = "4px";
    (el as HTMLElement).style.overflow = "visible";
  });
  container.querySelectorAll("hr").forEach((el) => {
    (el as HTMLElement).style.border = "none";
    (el as HTMLElement).style.borderTop = "1px solid #c9c4b4";
    (el as HTMLElement).style.margin = "1.5rem 0";
  });

  document.body.appendChild(container);

  await html2pdf()
    .set({
      margin: [15, 15, 15, 15],
      filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    })
    .from(container)
    .save();

  document.body.removeChild(container);
  return filename;
}

export async function downloadAsDocx(
  json: TiptapNode,
  title: string
): Promise<string> {
  const paragraphs = (json.content ?? []).flatMap((node) =>
    tiptapNodeToParagraphs(node)
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ children: [] })],
      },
    ],
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 24 },
          paragraph: { spacing: { after: 160 } },
        },
        {
          id: "Heading1",
          name: "heading 1",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 56, bold: true, color: "1A1A18" },
          paragraph: { spacing: { before: 360, after: 200 } },
        },
        {
          id: "Heading2",
          name: "heading 2",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 44, bold: true, color: "1A1A18" },
          paragraph: { spacing: { before: 280, after: 160 } },
        },
        {
          id: "Heading3",
          name: "heading 3",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 34, bold: true, color: "1A1A18" },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        {
          id: "Heading4",
          name: "heading 4",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 28, bold: true, color: "1A1A18" },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
        {
          id: "Heading5",
          name: "heading 5",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 26, bold: true, color: "1A1A18" },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
        {
          id: "Heading6",
          name: "heading 6",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Calibri", size: 24, bold: true, color: "1A1A18" },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
      ],
    },
  });

  const blob = await Packer.toBlob(doc);
  const filename = sanitizeFilename(title) + ".docx";
  triggerDownload(blob, filename);
  return filename;
}

export function downloadAsHtml(html: string, title: string): string {
  const filename = sanitizeFilename(title) + ".html";
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title || "Untitled"}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #111110;
      color: #e8e4d9;
      font-family: 'Outfit', -apple-system, sans-serif;
      font-size: 16px;
      line-height: 1.75;
      padding: 3rem 1.5rem;
    }
    .container { max-width: 720px; margin: 0 auto; }
    h1, h2, h3 { font-family: 'DM Serif Display', Georgia, serif; color: #e8e4d9; margin: 2rem 0 1rem; line-height: 1.3; }
    h1 { font-size: 2rem; }
    h2 { font-size: 1.5rem; }
    h3 { font-size: 1.25rem; }
    p { margin: 0 0 1rem; }
    a { color: #f0c446; text-decoration: underline; text-underline-offset: 2px; }
    blockquote { border-left: 3px solid #f0c446; padding-left: 1rem; margin: 1rem 0; color: #a8a48e; }
    code { font-family: 'JetBrains Mono', monospace; background: #1a1914; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
    pre { background: #1a1914; padding: 1rem; border-radius: 8px; overflow-x: auto; margin: 1rem 0; }
    pre code { background: none; padding: 0; }
    hr { border: none; border-top: 1px solid rgba(255, 245, 200, 0.1); margin: 2rem 0; }
    ul, ol { padding-left: 1.5rem; margin: 0 0 1rem; }
    li { margin: 0.25rem 0; }
    strong { font-weight: 600; }
    em { font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    ${html}
  </div>
</body>
</html>`;
  const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
  triggerDownload(blob, filename);
  return filename;
}
