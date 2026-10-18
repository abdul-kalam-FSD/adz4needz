// Mounted ONLY under /api/admin/assignments (admin). The service re-checks the role.
export function createAssignmentHandlers({ assignmentService }) {
  return {
    async overview(req, res) { res.status(200).set('Cache-Control', 'no-store').json(await assignmentService.overview(req.user, req.query.date)); },
    async assign(req, res) { res.status(200).set('Cache-Control', 'no-store').json(await assignmentService.assign(req.user, req.body)); }
  };
}
