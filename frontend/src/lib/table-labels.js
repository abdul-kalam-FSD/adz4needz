// Pure helpers for the phone layout of tables (no DOM, no React), so they can be unit tested.
// On a phone every table row is drawn as a card and each cell shows its column heading as a label. The heading text is the only source,
// so a column renamed in the page is renamed in the card too.

// headCells: [{ text, colSpan }] for the last header row, in order. Returns one label per column position (a heading that spans
// two columns labels both).
export function columnLabels(headCells) {
  const labels = [];
  for (const c of headCells || []) {
    const span = Math.max(1, Math.floor(Number(c && c.colSpan) || 1));
    const text = String((c && c.text) || '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < span; i += 1) labels.push(text);
  }
  return labels;
}

// bodyCells: [{ colSpan }] for one data row. Returns the label for each cell (empty string = no label, e.g. an actions column
// whose heading is empty, or a cell beyond the last heading).
export function rowLabels(labels, bodyCells) {
  const out = [];
  let col = 0;
  for (const c of bodyCells || []) {
    out.push(labels[col] || '');
    col += Math.max(1, Math.floor(Number(c && c.colSpan) || 1));
  }
  return out;
}
