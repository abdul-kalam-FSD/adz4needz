// Display helpers for the lead-import screen (pure, unit-tested).
export const ROW_STATUS_LABEL = {
  valid: 'Ready to import',
  invalid: 'Has errors',
  duplicate_in_file: 'Repeated in this file',
  duplicate_existing: 'Already in the system'
};
export const rowStatusLabel = (s) => ROW_STATUS_LABEL[s] || s;

export function formatErrors(errors) {
  return Object.values(errors || {}).filter(Boolean).join(' ');
}

// Counts line shown above the preview, e.g. "120 rows: 100 ready, 8 with errors, 5 repeated in file, 7 already in system".
export function countsSentence(c) {
  if (!c || !c.total) return 'No rows checked yet.';
  return `${c.total} rows: ${c.valid} ready, ${c.invalid} with errors, ${c.duplicateInFile} repeated in the file, ${c.duplicateExisting} already in the system.`;
}

// Rows that will be inserted if the admin confirms now.
export const importableCount = (c, includeExisting) => (c ? c.valid + (includeExisting ? c.duplicateExisting : 0) : 0);

// Client-side check before upload (the server validates again).
export function validateUploadFile(file, maxBytes = 5 * 1024 * 1024) {
  if (!file) return 'Choose an .xlsx or .csv file.';
  if (!/\.(xlsx|csv)$/i.test(file.name)) return 'Only .xlsx and .csv files can be imported.';
  if (file.size === 0) return 'The selected file is empty.';
  if (file.size > maxBytes) return `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  return null;
}
