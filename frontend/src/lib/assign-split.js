// "Suggest a split" for Assign leads: give each lead, one at a time, to the BDE with the fewest open leads (counting what they were already
// given in this split). Ties go to the lower id, so the result is stable. Same rule as suggestSplit() in the backend assignments service.
export function suggestSplit(total, bdes) {
  if (!Number.isInteger(total) || total < 1 || bdes.length === 0) return [];
  const load = bdes.map((b) => ({ id: Number(b.id), level: Number(b.openLeads) || 0, count: 0 }));
  for (let i = 0; i < total; i += 1) {
    load.sort((a, b) => (a.level + a.count) - (b.level + b.count) || a.id - b.id);
    load[0].count += 1;
  }
  return load.filter((x) => x.count > 0).sort((a, b) => a.id - b.id).map((x) => ({ id: x.id, count: x.count }));
}
