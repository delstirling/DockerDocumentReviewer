export type ExtractedDocumentRole = "subject" | "context";

export interface ExtractedDocument {
  name: string;
  content: string;
  mimeType: string;
  role: ExtractedDocumentRole;
  size: number;
}

const PDF_MIME_TYPE = "application/pdf";
const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXT_MIME_TYPE = "text/plain";

const normalizeExtractedText = (text: string): string =>
  text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();

const getFileExtension = (fileName: string): string => {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
};

const isPdfFile = (file: File): boolean => {
  const extension = getFileExtension(file.name);
  return file.type === PDF_MIME_TYPE || extension === "pdf";
};

const isDocxFile = (file: File): boolean => {
  const extension = getFileExtension(file.name);
  return file.type === DOCX_MIME_TYPE || extension === "docx";
};

const isTextFile = (file: File): boolean => {
  const extension = getFileExtension(file.name);
  return file.type === TEXT_MIME_TYPE || extension === "txt";
};

const extractTextFromPdf = async (file: File): Promise<string> => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({
    data,
    disableWorker: true,
  } as any).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(pageText);
  }

  return normalizeExtractedText(pages.join("\n\n"));
};

const extractTextFromDocx = async (file: File): Promise<string> => {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });

  return normalizeExtractedText(result.value);
};

const extractTextFromPlainText = async (file: File): Promise<string> =>
  normalizeExtractedText(await file.text());

export const extractTextFromFile = async (
  file: File,
  role: ExtractedDocumentRole,
): Promise<ExtractedDocument> => {
  let content = "";

  if (isPdfFile(file)) {
    content = await extractTextFromPdf(file);
  } else if (isDocxFile(file)) {
    content = await extractTextFromDocx(file);
  } else if (isTextFile(file)) {
    content = await extractTextFromPlainText(file);
  } else {
    throw new Error(`Unsupported document type: ${file.type || file.name}`);
  }

  return {
    name: file.name,
    content,
    mimeType: file.type || "application/octet-stream",
    role,
    size: file.size,
  };
};

export const calculatePayloadSize = (documents: ExtractedDocument[]): number => {
  const encoder = new TextEncoder();
  return documents.reduce((total, document) => {
    return (
      total +
      encoder.encode(document.name).length +
      encoder.encode(document.mimeType).length +
      encoder.encode(document.content).length
    );
  }, 0);
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) {
    return "0 Bytes";
  }

  const units = ["Bytes", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};