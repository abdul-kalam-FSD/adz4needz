// Same handlers are mounted twice: /api/interviews (BDE) and /api/admin/interviews (admin, read-only).
// The service decides what the caller (req.user) may do.
export function createInterviewHandlers({ interviewService }) {
  return {
    async list(req, res) { res.status(200).json(await interviewService.list(req.user, req.query)); },
    async summary(req, res) { res.status(200).json(await interviewService.summary(req.user, req.query)); },
    async overview(req, res) { res.status(200).json(await interviewService.overview(req.user, req.query)); },
    async get(req, res) { res.status(200).json({ interview: await interviewService.get(req.user, req.params.id, req.query) }); },
    async create(req, res) { res.status(201).json({ interview: await interviewService.create(req.user, req.body) }); },
    async update(req, res) { res.status(200).json({ interview: await interviewService.update(req.user, req.params.id, req.body) }); }
  };
}
