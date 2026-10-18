// Mounted ONLY under /api/admin/lead-sheet (admin). The service re-checks the role.
export function createLeadSheetHandlers({ leadSheetService }) {
  return {
    async download(req, res) {
      const f = await leadSheetService.exportSheet(req.user, req.query.bdeId);
      res.status(200).set({ 'Content-Type': f.mime, 'Content-Disposition': `attachment; filename="${f.fileName}"`, 'Content-Length': String(f.buffer.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).send(f.buffer);
    },
    async preview(req, res) { res.status(200).set('Cache-Control', 'no-store').json(await leadSheetService.preview(req.user, { body: req.body })); },
    async apply(req, res) { res.status(200).set('Cache-Control', 'no-store').json(await leadSheetService.apply(req.user, { body: req.body })); }
  };
}
