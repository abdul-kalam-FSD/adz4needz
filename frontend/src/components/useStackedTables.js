import { useEffect } from 'react';
import { columnLabels, rowLabels } from '../lib/table-labels.js';

// Phone layout support for every `.table-wrap table` inside `ref`: sets data-label on each cell (from the column headings) so the
// stylesheet can draw one card per row, and sets explicit table roles so screen readers still announce a table once the CSS
// changes the display type. Runs again whenever the page content changes (a list loads, a page of results is replaced).
// Setting attributes does not re-trigger the observer (it only watches added and removed nodes).
const ROLES = { TABLE: 'table', THEAD: 'rowgroup', TBODY: 'rowgroup', TFOOT: 'rowgroup', TR: 'row', TH: 'columnheader', TD: 'cell' };

function setAttr(el, name, value) { if (el.getAttribute(name) !== value) el.setAttribute(name, value); }

export function labelTable(table) {
  const headRows = table.querySelectorAll('thead tr');
  const head = headRows.length ? Array.from(headRows[headRows.length - 1].children) : [];
  const labels = columnLabels(head.map((c) => ({ text: c.textContent, colSpan: c.colSpan })));
  setAttr(table, 'role', ROLES.TABLE);
  table.querySelectorAll('thead, tbody, tfoot').forEach((g) => setAttr(g, 'role', ROLES[g.tagName]));
  table.querySelectorAll('tr').forEach((tr) => setAttr(tr, 'role', ROLES.TR));
  table.querySelectorAll('th').forEach((c) => setAttr(c, 'role', ROLES.TH));
  table.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
    const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    const row = rowLabels(labels, cells.map((c) => ({ colSpan: c.colSpan })));
    cells.forEach((c, i) => { setAttr(c, 'data-label', row[i]); if (c.tagName === 'TD') setAttr(c, 'role', ROLES.TD); });
  });
}

export function useStackedTables(ref) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    let frame = 0;
    const run = () => {
      frame = 0;
      root.querySelectorAll('.table-wrap table').forEach(labelTable);
      // A table wider than its box scrolls sideways: make that box reachable by keyboard and name it (WCAG 2.1.1 / scrollable region)
      root.querySelectorAll('.table-wrap').forEach((w) => {
        const scrolls = w.scrollWidth > w.clientWidth + 1;
        if (scrolls) { setAttr(w, 'tabindex', '0'); setAttr(w, 'role', 'region'); setAttr(w, 'aria-label', 'Table, scroll sideways for more columns'); }
        else { w.removeAttribute('tabindex'); w.removeAttribute('role'); w.removeAttribute('aria-label'); }
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(run); };
    run();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    return () => { window.removeEventListener('resize', schedule); observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [ref]);
}
