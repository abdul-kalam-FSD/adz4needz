export function createAdminHandlers({ adminService }) {
  return {
    async listBdes(req, res) {
      res.status(200).json({ bdes: await adminService.listBdes() });
    },
    async dailyOverview(req, res) {
      res.status(200).json(await adminService.dailyOverview(req.query.date));
    },
    async bdeDetail(req, res) {
      res.status(200).json(await adminService.bdeDetail(req.params.id, req.query.limit));
    }
  };
}
