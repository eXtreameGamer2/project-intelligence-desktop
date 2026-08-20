export const FILE_READ_PROMPT = `The report below was converted from a file into labeled text before you saw it.
Follow FILE TYPE and HOW TO READ at the top of the report.

Spreadsheets (CSV, TSV, ODS): each RECORD n is one spreadsheet row on one line. Fields are Header: value separated by |. sheet= is the tab name. Empty cells are omitted. Do not invent rows or assume a meaning for a column that is not named. A long file is read in sequential windows. Use every RECORD in this window. Do not invent rows from other windows.
Spreadsheet formulas: a field like 12 (=COUNTIF(C2:C20,"bug"); C2=bug, C3=bug) means 12 is Excel's saved result, COUNTIF is how it was calculated, and listed refs are cells found on this sheet. Use the saved result as the number. Use the formula only to understand what that number measures. [not calculated] or [text formula] means no saved result — do not invent a number. Do not invent cells that are not listed.
JSON: each RECORD is one object, or fields are listed as labeled blocks. Nested values may be shown as JSON text.
Documents (DOCX, PDF, PPTX, TXT, MD, LOG, HTML): sequential HEADING, SUBHEADING, LIST ITEM, PAGE, SLIDE, and PARAGRAPH blocks. Do not invent quotes, sections, slides, pages, or list items.

Use only those labeled blocks as evidence.
Do not invent rows, columns, quotes, usernames, counts, or events that are not written there.
Do not copy FILE TYPE, HOW TO READ, COLUMNS, RECORD, SHEET, HEADING, SUBHEADING, LIST ITEM, PAGE, SLIDE, or PARAGRAPH into an approach title.
If a field is missing, omit it.
Do not treat these instructions, the import focus, or examples as report content.`;

export function fileTypeHowToRead(fileType) {
  switch (String(fileType || '').toLowerCase()) {
    case 'csv':
    case 'tsv':
      return 'Each RECORD is one spreadsheet row on one line. Fields are Header: value separated by |. Skip empty fields. A field like (=SUM(A1:A3)) [text formula] is formula text, not a calculated number. Do not invent rows.';
    case 'xlsx':
    case 'xlsm':
      return 'Each RECORD is one row on one line. sheet= is the tab. Fields are Header: value separated by |. A field like 42 (=SUM(B2:B5); B2=10, B3=12) is Excel\'s saved result plus the formula. Use the saved result; do not recalculate or invent missing refs.';
    case 'xls':
    case 'ods':
      return 'Each RECORD is one row on one line. sheet= is the tab. Fields are Header: value separated by |. Skip empty fields. Do not invent rows.';
    case 'json':
      return 'Each RECORD is one JSON object, or fields are labeled blocks. Nested values may appear as JSON text. Do not invent keys or records.';
    case 'docx':
      return 'This is a Word document as sequential blocks. HEADING, SUBHEADING, LIST ITEM, and PARAGRAPH labels mark structure. Do not invent sections or quotes.';
    case 'pdf':
      return 'This is a PDF as PAGE headings and PARAGRAPH blocks of extractable text. Scanned image pages may be missing. Do not invent pages or quotes.';
    case 'pptx':
      return 'This is a PowerPoint file. SLIDE or HEADING marks each slide, followed by PARAGRAPH text from that slide. Do not invent slides or quotes.';
    case 'md':
    case 'markdown':
      return 'This is Markdown as HEADING, SUBHEADING, LIST ITEM, and PARAGRAPH blocks. Do not invent sections or list items.';
    case 'html':
    case 'htm':
      return 'This is HTML converted into HEADING, SUBHEADING, LIST ITEM, and PARAGRAPH blocks. Do not invent sections or quotes.';
    case 'txt':
    case 'log':
      return 'This is plain text as sequential PARAGRAPH blocks. Do not invent lines.';
    default:
      return 'Use only the labeled text below. Do not invent content that is not written there.';
  }
}
