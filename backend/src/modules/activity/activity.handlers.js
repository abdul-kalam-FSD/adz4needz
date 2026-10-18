// Mounted ONLY under /api/admin/activity (admin, read-only). The service re-checks the role.
export function createActivityHandlers({ activityService }) {
  return { async feed(req, res) { res.status(200).set('Cache-Control', 'no-store').json(await activityService.feed(req.user, req.query)); } };
}
