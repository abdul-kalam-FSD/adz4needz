export function createDailyReportHandlers({ reportService }) {
  return {
    async create(req, res) {
      const report = await reportService.submit(req.user.id, req.body);
      res.status(201).json({ report });
    },
    async list(req, res) {
      const reports = await reportService.listOwn(req.user.id, req.query.limit);
      res.status(200).json({ reports });
    }
  };
}
