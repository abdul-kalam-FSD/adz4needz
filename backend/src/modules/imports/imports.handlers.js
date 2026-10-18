// Mounted ONLY under /api/admin/imports (admin). The service re-checks the role.
export function createImportHandlers({ importService }) {
  return {
    async options(req, res) { res.status(200).json(await importService.options(req.user)); },
    async upload(req, res) {
      const batch = await importService.upload(req.user, { body: req.body, fileName: req.query.name, defaultBdeId: req.query.defaultBdeId, defaultCourse: req.query.defaultCourse });
      res.status(201).json({ import: batch });
    },
    async list(req, res) { res.status(200).json({ imports: await importService.list(req.user) }); },
    async get(req, res) { res.status(200).json({ import: await importService.get(req.user, req.params.id) }); },
    async rows(req, res) { res.status(200).json(await importService.rows(req.user, req.params.id, req.query)); },
    async update(req, res) { res.status(200).json({ import: await importService.update(req.user, req.params.id, req.body) }); },
    async commit(req, res) { res.status(200).json({ import: await importService.commit(req.user, req.params.id, req.body) }); },
    async cancel(req, res) { res.status(200).json({ import: await importService.cancel(req.user, req.params.id) }); },
    async invalidCsv(req, res) {
      const csv = await importService.invalidRowsCsv(req.user, req.params.id);
      res.status(200).set({
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="import-${Number(req.params.id)}-invalid-rows.csv"`,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store'
      }).send(csv);
    }
  };
}
