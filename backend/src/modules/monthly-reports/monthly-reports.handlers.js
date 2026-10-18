export function createMonthlyReportHandlers({ monthlyReportService }) {
  return {
    async team(req, res) { res.status(200).json({ report: await monthlyReportService.teamReport(req.user, req.query.month) }); },
    async range(req, res) { res.status(200).json({ report: await monthlyReportService.rangeReport(req.user, req.query.from, req.query.to) }); },
    async own(req, res) { res.status(200).json({ report: await monthlyReportService.ownReport(req.user, req.query.month) }); },
    exportAs: (format) => async (req, res) => {
      const f = await monthlyReportService.exportReport(req.user, req.query.month, format, { from: req.query.from, to: req.query.to });
      res.status(200).set({
        'Content-Type': f.mime, 'Content-Disposition': `attachment; filename="${f.fileName}"`, 'Content-Length': String(f.buffer.length),
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store'
      }).send(f.buffer);
    },
    async setTargets(req, res) { res.status(200).json({ bde: await monthlyReportService.setTargets(req.user, req.body) }); }
  };
}
