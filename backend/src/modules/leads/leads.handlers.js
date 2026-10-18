// Same handlers are mounted twice: /api/leads (BDE) and /api/admin/leads (admin, read-only).
// The service decides what the caller (req.user) may do.
export function createLeadHandlers({ leadService }) {
  return {
    async statuses(req, res) { res.status(200).json({ statuses: await leadService.listStatuses(req.user) }); },
    async list(req, res) { res.status(200).json(await leadService.list(req.user, req.query)); },
    async summary(req, res) { res.status(200).json(await leadService.followUpSummary(req.user, req.query)); },
    async get(req, res) { res.status(200).json({ lead: await leadService.get(req.user, req.params.id, req.query) }); },
    async create(req, res) { res.status(201).json({ lead: await leadService.create(req.user, req.body) }); },
    async update(req, res) { res.status(200).json({ lead: await leadService.update(req.user, req.params.id, req.body) }); },
    async setStatus(req, res) { res.status(200).json({ lead: await leadService.setStatus(req.user, req.params.id, req.body) }); }
  };
}
