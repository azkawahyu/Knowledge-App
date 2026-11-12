// Document parsers.
//
// Registry-driven: each parser declares the extensions it handles. Adding a new
// format = adding a parser entry. Parsers return raw extracted text + metadata.

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import Tesseract from 'tesseract.js';
import { DocKind, ParseResult } from './types';
import * as cheerio from 'cheerio';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------


export interface Parser {
  extensions: readonly string[];
  parse(filePath: string): Promise<ParseResult>;
}

// ---------------------------------------------------------------------------
// Text-based readers (no dependencies)
// ---------------------------------------------------------------------------

function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

function readBinaryFile(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

// ---------------------------------------------------------------------------
// HTML parser (cheerio)
// ---------------------------------------------------------------------------

async function parseHtml(filePath: string): Promise<ParseResult> {
  const html = readTextFile(filePath);
  const $ = cheerio.load(html);
  // Grab <title> and visible text.
  const title = $('title').first().text().trim();
  const text = $('body').text() || html;
  const clean = text.replace(/\s+/g, ' ').trim();
  return {
    text: clean,
    language: 'en',
    metadata: {
      title,
      format: 'html',
    },
  };
}

// ---------------------------------------------------------------------------
// PDF parser (pdftotext CLI)
// ---------------------------------------------------------------------------

async function parsePdf(filePath: string): Promise<ParseResult> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('pdftotext', [filePath, '-']);
    return {
      text: stdout,
      language: 'en',
      metadata: { format: 'pdf' },
    };
  } catch (err: any) {
    throw new Error(`PDF parse failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// DOCX parser (zip-of-XML: extract word/document.xml, pull <w:t> text)
// ---------------------------------------------------------------------------

async function parseDocx(filePath: string): Promise<ParseResult> {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) {
    throw new Error('DOCX does not contain word/document.xml');
  }
  const xml = entry.getData().toString('utf-8');
  const texts = xml
    .match(/<w:t[^>]*>([^<]+)<\/w:t>/g)
    ?.map((t) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean) ?? [];
  const text = texts.join(' ');
  return {
    text,
    language: 'en',
    metadata: { format: 'docx' },
  };
}

// ---------------------------------------------------------------------------
// XLSX parser (SheetJS `xlsx`)
// ---------------------------------------------------------------------------

async function parseXlsx(filePath: string): Promise<ParseResult> {
  const data = readBinaryFile(filePath);
  const workbook = XLSX.read(data, { type: 'buffer' });
  const sheets: string[] = [];
  const rows: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    sheets.push(sheetName);
    const range = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    for (const row of range) {
      const vals = Object.values(row).map((v) => String(v ?? '').trim());
      if (vals.some((v) => v.length > 0)) rows.push(vals.join('\t'));
    }
  }
  const text = sheets.length
    ? `[[${sheets.join('],[')}]]${rows.length ? `\n${rows.join('\n')}` : ''}`
    : '';
  return {
    text,
    language: 'en',
    metadata: { format: 'xlsx', sheets: sheets.length },
  };
}

// ---------------------------------------------------------------------------
// PPTX parser (ZIP-of-XML via adm-zip)
// ---------------------------------------------------------------------------

async function parsePptx(filePath: string): Promise<ParseResult> {
  const zip = new AdmZip(filePath);
  const slideXmls: string[] = [];
  const slideFiles = zip.getEntries().filter((e) =>
    e.name.startsWith('ppt/slides/slide') && e.name.endsWith('.xml'),
  );
  // Sort so slide order is preserved.
  slideFiles.sort((a, b) => {
    const na = a.name.replace('ppt/slides/slide', '').replace('.xml', '');
    const nb = b.name.replace('ppt/slides/slide', '').replace('.xml', '');
    return na.localeCompare(nb);
  });
  for (const entry of slideFiles) {
    const xml = entry.getData().toString('utf-8');
    // Strip XML tags, keep text. `xml:space="preserve"` attrs are stripped by
    // replacing tags with a space.
    const text = xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) slideXmls.push(text);
  }
  const text = slideXmls.join('\n\n').trim();
  return {
    text,
    language: 'en',
    metadata: { format: 'pptx', slides: slideXmls.length },
  };
}

// ---------------------------------------------------------------------------
// Tesseract.js OCR for scans (image files)
// ---------------------------------------------------------------------------

async function parseImage(filePath: string): Promise<ParseResult> {
  const worker = await Tesseract.createWorker('eng');
  await worker.load();
  try {
    const { data } = await worker.recognize(filePath);
    return {
      text: data?.text || '',
      language: 'eng',
      metadata: { format: 'image' },
    };
  } finally {
    await worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PARSERS: Parser[] = [
  // Text-based readers (highest priority – fast, dependency-free)
  {
    extensions: ['txt', 'md', 'markdown', 'csv', 'json', 'xml', 'yaml', 'yml', 'log'],
    async parse(filePath: string): Promise<ParseResult> {
      const text = readTextFile(filePath);
      return {
        text,
        language: 'en',
        metadata: { format: path.extname(filePath).slice(1), size: fs.statSync(filePath).size },
      };
    },
  },
  {
    extensions: ['html', 'htm'],
    parse: parseHtml,
  },
  // Document & spreadsheet parsers
  {
    extensions: ['pdf'],
    parse: parsePdf,
  },
  {
    extensions: ['docx'],
    parse: parseDocx,
  },
  {
    extensions: ['xlsx'],
    parse: parseXlsx,
  },
  {
    extensions: ['pptx'],
    parse: parsePptx,
  },
  // Image / scan parser (OCR)
  {
    extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff'],
    parse: parseImage,
  },
];

const EXTENSION_TO_KIND: Record<string, DocKind> = {
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  csv: 'csv',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  log: 'log',
  html: 'html',
  htm: 'html',
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  png: 'pdf', // scanned image -> OCR -> pdf
  jpg: 'pdf',
  jpeg: 'pdf',
  tif: 'pdf',
  tiff: 'pdf',
};

export function detectKind(filename: string): DocKind {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return EXTENSION_TO_KIND[ext] ?? 'other';
}

export function isUnsupported(ext: string): boolean {
  const exts = new Set(
    PARSERS.flatMap((p) => p.extensions.map((e) => e.toLowerCase())),
  );
  return !exts.has(ext.toLowerCase());
}

export async function parseFile(
  filePath: string,
  options?: { language?: string },
): Promise<ParseResult> {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const parser = PARSERS.find((p) => p.extensions.includes(ext));
  if (!parser) {
    throw new Error(`Unsupported file type: .${ext}`);
  }
  return parser.parse(filePath);
}

export function getParser(ext: string): Parser | undefined {
  return PARSERS.find((p) => p.extensions.includes(ext));
}
