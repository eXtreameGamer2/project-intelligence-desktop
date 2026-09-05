export const ACCEPTED_DOCUMENT_UPLOADS =
  '.docx,.pdf,.pptx,.txt,.md,.markdown,.log';

export const ACCEPTED_STRUCTURED_UPLOADS =
  '.xlsx,.xlsm,.csv,.tsv,.json,.html,.htm';

export const ACCEPTED_UPLOADS = `${ACCEPTED_DOCUMENT_UPLOADS},${ACCEPTED_STRUCTURED_UPLOADS
  .split(',')
  .filter((ext) => !/^\.(xlsx|xlsm)$/i.test(ext))
  .join(',')}`;

export function isStructuredImportName(name) {
  return /\.(xlsx|xlsm|csv|tsv|json|html|htm)$/i.test(String(name || ''));
}

export function acceptedUploads({ structured = false } = {}) {
  return structured
    ? `${ACCEPTED_DOCUMENT_UPLOADS},${ACCEPTED_STRUCTURED_UPLOADS}`
    : ACCEPTED_DOCUMENT_UPLOADS;
}
