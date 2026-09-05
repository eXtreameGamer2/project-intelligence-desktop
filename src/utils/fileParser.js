import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { fileTypeHowToRead } from './fileReadGuide.js';

const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xlsm']);
const STRUCTURED_EXTENSIONS = new Set([
  ...EXCEL_EXTENSIONS,
  '.csv',
  '.tsv',
  '.json',
  '.html',
  '.htm',
]);
const STRUCTURED_FILE_MESSAGE =
  'CSV, Excel (.xlsx/.xlsm), JSON, and HTML need multi-pass import with 4 to 8 passes. Turn that on in Settings, or upload Word, PDF, PowerPoint, or text instead.';

const DOCUMENT_EXTENSIONS = new Set([
  '.docx',
  '.pdf',
  '.pptx',
  '.txt',
  '.md',
  '.markdown',
  '.log',
]);
const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'application/csv',
  'text/tab-separated-values',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/html',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
]);
const UNSUPPORTED_FILE_MESSAGE =
  'Unsupported file type. Upload Word, PDF, PowerPoint, or text. CSV, Excel, ODS, JSON, and HTML need multi-pass with 4 to 8 passes.';

const MAX_COLUMNS = 40;
const MAX_RECORDS = 2500;
const MAX_DOC_BLOCKS = 2500;
const MAX_FIELD_CHARS = 240;

/**
 * @param {string} fileName
 */
export function getFileExtension(fileName) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

/**
 * Validate uploaded file type against supported import formats.
 * @param {{ originalname: string, mimetype: string }} file
 */
export function validateUploadFile(
  file,
  { allowStructured = false, includeOpenStructured = true } = {}
) {
  const extension = getFileExtension(file.originalname);
  const allowed = new Set(DOCUMENT_EXTENSIONS);
  if (allowStructured) {
    for (const ext of STRUCTURED_EXTENSIONS) allowed.add(ext);
  } else if (includeOpenStructured) {
    for (const ext of STRUCTURED_EXTENSIONS) {
      if (!EXCEL_EXTENSIONS.has(ext)) allowed.add(ext);
    }
  }

  if (STRUCTURED_EXTENSIONS.has(extension) && !allowed.has(extension)) {
    throw new Error(STRUCTURED_FILE_MESSAGE);
  }

  if (!allowed.has(extension)) {
    throw new Error(UNSUPPORTED_FILE_MESSAGE);
  }

  const mime = String(file.mimetype || '').toLowerCase();
  if (mime && !ALLOWED_MIME_TYPES.has(mime) && !allowed.has(extension)) {
    throw new Error(`Unsupported MIME type: ${file.mimetype}`);
  }
}

const MAX_FORMULA_REFS = 12;
const MAX_FORMULA_RANGE = 80;
const CELL_REF_RE =
  /(?:(?:'[^']+'|[A-Za-z0-9._]+)!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?/gi;

/**
 * @param {unknown} value
 * @param {number} [depth]
 */
function stringifyPlainValue(value, depth = 0) {
  if (depth > 4 || value == null || value === '') {
    return '';
  }

  if (typeof value !== 'object') {
    return String(value).trim();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value.error === 'string') {
    return value.error;
  }

  if (typeof value.text === 'string') {
    return value.text.trim();
  }

  if (Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text || '').join('').trim();
  }

  if (value.result != null) {
    return stringifyPlainValue(value.result, depth + 1);
  }

  if (typeof value.hyperlink === 'string' && value.text) {
    return String(value.text).trim();
  }

  if (typeof value.hyperlink === 'string') {
    return value.hyperlink.trim();
  }

  return '';
}

function colLetter(columnNumber) {
  let n = Number(columnNumber);
  if (!Number.isInteger(n) || n < 1) return '';
  let text = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    text = String.fromCharCode(65 + rem) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

function colNumber(letters) {
  return String(letters || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .split('')
    .reduce((sum, char) => sum * 26 + (char.charCodeAt(0) - 64), 0);
}

function parseA1(address) {
  const match = String(address || '')
    .replace(/\$/g, '')
    .match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return { col: colNumber(match[1]), row: Number(match[2]) };
}

function readFormula(cell) {
  if (!cell) return '';
  const value = cell.value;
  const raw =
    (typeof cell.formula === 'string' && cell.formula) ||
    (value && typeof value === 'object' && (value.formula || value.sharedFormula)) ||
    '';
  return String(raw).replace(/^=/, '').trim();
}

function formatExcelCell(cell) {
  const formula = readFormula(cell);
  const value = cell?.value;
  const resultSource =
    formula && value && typeof value === 'object' && !(value instanceof Date)
      ? value.result
      : value;
  const display =
    stringifyPlainValue(resultSource) || stringifyPlainValue(cell?.result);
  const formatted = formula
    ? display
      ? `${display} (=${formula})`
      : `(=${formula}) [not calculated]`
    : display;
  return { display, formula, formatted };
}

function collectFormulaRefs(formula, lookup, selfAddress) {
  const text = String(formula || '');
  if (!text) return '';
  const seen = new Set();
  const parts = [];
  let omitted = 0;

  for (const match of text.matchAll(new RegExp(CELL_REF_RE.source, 'gi'))) {
    const start = parseA1(match[1]);
    const end = match[2] ? parseA1(match[2]) : start;
    if (!start || !end) continue;
    const r1 = Math.min(start.row, end.row);
    const r2 = Math.max(start.row, end.row);
    const c1 = Math.min(start.col, end.col);
    const c2 = Math.max(start.col, end.col);
    const count = (r2 - r1 + 1) * (c2 - c1 + 1);
    if (count > MAX_FORMULA_RANGE) {
      omitted += count;
      continue;
    }
    outer: for (let row = r1; row <= r2; row += 1) {
      for (let col = c1; col <= c2; col += 1) {
        const address = `${colLetter(col)}${row}`;
        if (address === selfAddress || seen.has(address)) continue;
        seen.add(address);
        const value = lookup.get(address);
        if (value) {
          if (parts.length < MAX_FORMULA_REFS) parts.push(`${address}=${value}`);
          else omitted += 1;
        }
        if (parts.length >= MAX_FORMULA_REFS && omitted > 0) break outer;
      }
    }
  }

  if (!parts.length) return '';
  return omitted ? `${parts.join(', ')}, ${omitted} more refs omitted` : parts.join(', ');
}

function withFormulaRefs(parsed, lookup) {
  if (!parsed?.formula) return parsed?.formatted || '';
  const refs = collectFormulaRefs(parsed.formula, lookup, parsed.address);
  if (!refs) return parsed.formatted;
  if (parsed.formatted.endsWith(')')) {
    return `${parsed.formatted.slice(0, -1)}; ${refs})`;
  }
  return `${parsed.formatted} (${refs})`;
}

function uniqueHeaders(names) {
  const used = new Map();
  return names.map((name, index) => {
    const base = String(name || '').trim() || `column_${index + 1}`;
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function cellDisplay(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String(value.display || value.formatted || '').trim();
  }
  return String(value ?? '').trim();
}

function looksLikeHeader(values) {
  const cells = (values || []).map(cellDisplay).filter(Boolean);
  if (cells.length < 2) return false;
  const headerLike = cells.filter(
    (cell) => /[a-zA-Z]/.test(cell) && !/^\d+([.,]\d+)?$/.test(cell)
  );
  return headerLike.length >= Math.ceil(cells.length * 0.5);
}

function formatCsvCell(value) {
  const text = String(value ?? '').trim();
  if (text.startsWith('=')) {
    return `(${text}) [text formula]`;
  }
  return text;
}

function rowToRecord(columns, values) {
  const record = {};
  columns.forEach((column, index) => {
    const value = String(values[index] ?? '').trim();
    if (value) record[column] = value;
  });
  return record;
}

function compactFieldValue(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FIELD_CHARS);
}

function sheetNameFromMeta(meta = []) {
  const row = (meta || []).find((line) => /^SHEET:\s*/i.test(line));
  return row ? String(row).replace(/^SHEET:\s*/i, '').trim() : '';
}

function formatRecordLine(index, record, sheetName) {
  const fields = Object.entries(record || {}).filter(([, value]) => String(value || '').trim());
  if (!fields.length) return '';
  const body = fields.map(([key, value]) => `${key}: ${compactFieldValue(value)}`).join(' | ');
  const sheet = sheetName ? `sheet=${sheetName} | ` : '';
  return `RECORD ${index} | ${sheet}${body}`;
}

function formatWorkbook(fileType, sheets = []) {
  const lines = [`FILE TYPE: ${fileType}`, `HOW TO READ: ${fileTypeHowToRead(fileType)}`];
  let index = 0;
  let omitted = 0;
  for (const sheet of sheets) {
    const name = String(sheet?.name || '').trim();
    for (const extra of sheet?.extraMeta || []) {
      if (extra) lines.push(extra);
    }
    if (name) lines.push(`SHEET: ${name}`);
    if (sheet?.columns?.length) lines.push(`COLUMNS: ${sheet.columns.join(', ')}`);
    const records = Array.isArray(sheet?.records) ? sheet.records : [];
    const shown = records.slice(0, MAX_RECORDS);
    omitted += Math.max(0, records.length - shown.length);
    for (const record of shown) {
      index += 1;
      const line = formatRecordLine(index, record, name);
      if (line) lines.push(line);
    }
  }
  if (omitted) lines.push(`... ${omitted} more records omitted`);
  return lines.join('\n').trim();
}

function formatStructuredFile({ fileType, meta = [], columns = [], records = [] }) {
  return formatWorkbook(fileType, [
    {
      name: sheetNameFromMeta(meta),
      columns,
      records,
      extraMeta: (meta || []).filter((line) => !/^SHEET:\s*/i.test(line)),
    },
  ]);
}

function parseCsvTable(text, delimiter = ',') {
  const rows = parseCsv(text, {
    delimiter,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  });
  if (!Array.isArray(rows) || !rows.length) return { columns: [], records: [] };

  const normalized = rows.map((row) =>
    (Array.isArray(row) ? row : Object.values(row)).map((cell) => String(cell ?? '').trim())
  );
  const first = normalized[0] || [];
  const hasHeader = looksLikeHeader(first);
  const rawHeaders = hasHeader
    ? first.slice(0, MAX_COLUMNS)
    : first.slice(0, MAX_COLUMNS).map((_, index) => `column_${index + 1}`);
  const columns = uniqueHeaders(rawHeaders);
  const dataRows = hasHeader ? normalized.slice(1) : normalized;

  const records = dataRows.map((row) =>
    rowToRecord(
      columns,
      row.slice(0, MAX_COLUMNS).map(formatCsvCell)
    )
  );
  return { columns, records };
}

function sheetColumnCount(sheet) {
  let count = 0;
  sheet.eachRow((row) => {
    count = Math.max(count, row.cellCount || 0);
  });
  return Math.min(MAX_COLUMNS, count);
}

function sheetRowCells(row, columnCount) {
  const cells = [];
  for (let index = 1; index <= columnCount; index += 1) {
    const parsed = formatExcelCell(row.getCell(index));
    parsed.address = `${colLetter(index)}${row.number}`;
    cells.push(parsed);
  }
  return cells;
}

function parseSheetRecords(sheet) {
  const columnCount = sheetColumnCount(sheet);
  if (!columnCount) return { columns: [], records: [] };

  const rows = [];
  const lookup = new Map();
  sheet.eachRow((row) => {
    const cells = sheetRowCells(row, columnCount);
    cells.forEach((cell) => {
      if (cell.address && cell.display) lookup.set(cell.address, cell.display);
    });
    rows.push(cells);
  });
  const nonempty = rows.filter((row) => row.some((cell) => cell.formatted || cell.display));
  if (!nonempty.length) return { columns: [], records: [] };

  const first = nonempty[0];
  const hasHeader = looksLikeHeader(first);
  const columns = uniqueHeaders(
    hasHeader
      ? first.map((cell) => cellDisplay(cell))
      : first.map((_, index) => `column_${index + 1}`)
  );
  const dataRows = hasHeader ? nonempty.slice(1) : nonempty;
  const records = dataRows.map((row) =>
    rowToRecord(
      columns,
      row.map((cell) => withFormulaRefs(cell, lookup))
    )
  );
  return { columns, records };
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function formatDocumentBlocks(fileType, blocks) {
  const lines = [
    `FILE TYPE: ${fileType}`,
    `HOW TO READ: ${fileTypeHowToRead(fileType)}`,
    '',
  ];
  const shown = blocks.slice(0, MAX_DOC_BLOCKS);
  for (const block of shown) {
    lines.push(block);
  }
  if (blocks.length > MAX_DOC_BLOCKS) {
    lines.push(`... ${blocks.length - MAX_DOC_BLOCKS} more blocks omitted`);
  }
  return lines.join('\n').trim();
}

function structureMarkupHtml(html, fileType = 'docx') {
  let text = String(html || '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|tr|table|ul|ol)>/gi, '\n');
  text = text.replace(/<h1[^>]*>/gi, '\nHEADING: ');
  text = text.replace(/<h[2-6][^>]*>/gi, '\nSUBHEADING: ');
  text = text.replace(/<li[^>]*>/gi, '\nLIST ITEM: ');
  text = text.replace(/<\/t[dh]>/gi, ' | ');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);

  const blocks = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((block) =>
      /^(HEADING|SUBHEADING|LIST ITEM):/.test(block)
        ? block
        : `PARAGRAPH: ${block.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '')}`
    );

  return formatDocumentBlocks(fileType, blocks);
}

function bufferToText(buffer) {
  if (buffer?.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function structurePlainText(text, fileType) {
  const blocks = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((line) => `PARAGRAPH: ${line}`);
  return formatDocumentBlocks(fileType, blocks);
}

function structureMarkdown(text) {
  const blocks = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push(`${heading[1].length === 1 ? 'HEADING' : 'SUBHEADING'}: ${heading[2].trim()}`);
      continue;
    }
    const list = line.match(/^[-*+]\s+(.*)$/) || line.match(/^\d+[.)]\s+(.*)$/);
    if (list) {
      blocks.push(`LIST ITEM: ${list[1].trim()}`);
      continue;
    }
    blocks.push(`PARAGRAPH: ${line}`);
  }
  return formatDocumentBlocks('md', blocks);
}

function stringifyJsonValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function structureJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This JSON file could not be parsed.');
  }

  if (Array.isArray(data) && data.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    const keys = [];
    for (const item of data) {
      for (const key of Object.keys(item)) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    const columns = uniqueHeaders(keys.slice(0, MAX_COLUMNS));
    const records = data.map((item) =>
      rowToRecord(
        columns,
        columns.map((column) => stringifyJsonValue(item[column]))
      )
    );
    return formatStructuredFile({ fileType: 'json', columns, records });
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data).filter(([, value]) => value != null && value !== '');
    return formatDocumentBlocks(
      'json',
      entries.map(([key, value]) => `PARAGRAPH: ${key}: ${stringifyJsonValue(value)}`)
    );
  }

  if (Array.isArray(data)) {
    return formatDocumentBlocks(
      'json',
      data.map((item, index) => `LIST ITEM: ${index + 1}. ${stringifyJsonValue(item)}`)
    );
  }

  return formatDocumentBlocks('json', [`PARAGRAPH: ${stringifyJsonValue(data)}`]);
}

function tableRowsToStructured(fileType, rows, meta = []) {
  const normalized = (rows || []).map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => String(cell ?? '').trim())
  );
  const nonempty = normalized.filter((row) => row.some(Boolean));
  if (!nonempty.length) return '';
  const first = nonempty[0];
  const hasHeader = looksLikeHeader(first);
  const columns = uniqueHeaders(
    hasHeader
      ? first.slice(0, MAX_COLUMNS)
      : first.slice(0, MAX_COLUMNS).map((_, index) => `column_${index + 1}`)
  );
  const dataRows = hasHeader ? nonempty.slice(1) : nonempty;
  const records = dataRows.map((row) =>
    rowToRecord(columns, row.slice(0, MAX_COLUMNS).map(formatCsvCell))
  );
  return formatStructuredFile({ fileType, meta, columns, records });
}

async function parseExcelOpenXml(buffer, fileType) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets = [];
  workbook.eachSheet((sheet) => {
    const { columns, records } = parseSheetRecords(sheet);
    if (!records.length) return;
    sheets.push({ name: sheet.name, columns, records });
  });
  return { content: formatWorkbook(fileType, sheets), fileType };
}

async function extractPdfContent(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = Array.isArray(result?.pages)
      ? result.pages.map((page) => page?.text || '')
      : String(result?.text || '').split(/\f/);
    const blocks = [];
    pages.forEach((pageText, index) => {
      const paragraphs = String(pageText || '')
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (!paragraphs.length) return;
      blocks.push(`HEADING: Page ${index + 1}`);
      paragraphs.forEach((line) => blocks.push(`PARAGRAPH: ${line}`));
    });
    if (!blocks.length) {
      throw new Error('No extractable text in this PDF. Scanned image PDFs are not supported.');
    }
    return formatDocumentBlocks('pdf', blocks);
  } finally {
    await parser.destroy?.();
  }
}

function slideNumber(name) {
  const match = String(name).match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

async function extractPptxContent(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
  const blocks = [];
  for (const name of names) {
    const xml = await zip.files[name].async('string');
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map((match) => decodeEntities(match[1]).trim())
      .filter(Boolean);
    if (!texts.length) continue;
    blocks.push(`HEADING: Slide ${slideNumber(name)}`);
    texts.forEach((text) => blocks.push(`PARAGRAPH: ${text}`));
  }
  if (!blocks.length) {
    throw new Error('No extractable text in this PowerPoint file.');
  }
  return formatDocumentBlocks('pptx', blocks);
}

/**
 * Extract labeled text from supported spreadsheet, document, and data formats.
 * @param {{ buffer: Buffer, originalname: string }} file
 * @returns {Promise<{ content: string, fileType: string }>}
 */
export async function extractFileContent(
  file,
  { allowStructured = false, includeOpenStructured = true } = {}
) {
  validateUploadFile(file, { allowStructured, includeOpenStructured });

  const extension = getFileExtension(file.originalname);

  switch (extension) {
    case '.csv':
    case '.tsv': {
      const fileType = extension === '.tsv' ? 'tsv' : 'csv';
      const text = bufferToText(file.buffer);
      const { columns, records } = parseCsvTable(text, fileType === 'tsv' ? '\t' : ',');
      const content = formatStructuredFile({
        fileType,
        columns,
        records,
      });
      return { content: content || text.trim(), fileType };
    }

    case '.xlsx':
    case '.xlsm': {
      const fileType = extension === '.xlsm' ? 'xlsm' : 'xlsx';
      return parseExcelOpenXml(file.buffer, fileType);
    }

    case '.xls':
    case '.ods': {
      throw new Error(
        'Legacy .xls/.ods uploads are not supported. Save the workbook as .xlsx and try again.'
      );
    }

    case '.docx': {
      const result = await mammoth.convertToHtml({ buffer: file.buffer });
      const structured = structureMarkupHtml(result.value, 'docx');
      if (/^(HEADING|SUBHEADING|LIST ITEM|PARAGRAPH):/m.test(structured)) {
        return { content: structured, fileType: 'docx' };
      }
      const raw = await mammoth.extractRawText({ buffer: file.buffer });
      return {
        content: structurePlainText(raw.value, 'docx'),
        fileType: 'docx',
      };
    }

    case '.pdf':
      return { content: await extractPdfContent(file.buffer), fileType: 'pdf' };

    case '.pptx':
      return { content: await extractPptxContent(file.buffer), fileType: 'pptx' };

    case '.json':
      return { content: structureJson(bufferToText(file.buffer)), fileType: 'json' };

    case '.html':
    case '.htm':
      return {
        content: structureMarkupHtml(bufferToText(file.buffer), 'html'),
        fileType: 'html',
      };

    case '.md':
    case '.markdown':
      return { content: structureMarkdown(bufferToText(file.buffer)), fileType: 'md' };

    case '.txt':
    case '.log':
      return {
        content: structurePlainText(bufferToText(file.buffer), extension.slice(1)),
        fileType: extension.slice(1),
      };

    default:
      throw new Error(UNSUPPORTED_FILE_MESSAGE);
  }
}

export default { extractFileContent, validateUploadFile, getFileExtension };
