export function createCallLogHandlers({ callLogService }) {
  return {
    async record(req, res) {
      const result = await callLogService.record(req.user, req.body);
      res.status(result.duplicate ? 200 : 201).json(result); // 200 = "already recorded", nothing was counted twice
    },
    async undo(req, res) { res.status(200).json(await callLogService.undo(req.user, req.params.id)); },
    async summary(req, res) { res.status(200).json(await callLogService.dailySummary(req.user, req.query.date)); },
    async adminStats(req, res) { res.status(200).json(await callLogService.adminDailyStats(req.query.date)); }
  };
}
