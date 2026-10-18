// Mounted for BDEs under /api/... and for Admin (read-only) under /api/admin/... The service decides what the caller may do.
export function createPaymentHandlers({ paymentService }) {
  return {
    async list(req, res) { res.status(200).json(await paymentService.list(req.user, req.query)); },
    async summary(req, res) { res.status(200).json(await paymentService.summary(req.user, req.query)); },
    async overview(req, res) { res.status(200).json(await paymentService.overview(req.user, req.query)); },
    async get(req, res) { res.status(200).json({ payment: await paymentService.get(req.user, req.params.id) }); },
    async create(req, res) { res.status(201).json({ payment: await paymentService.create(req.user, req.body) }); },
    async update(req, res) { res.status(200).json({ payment: await paymentService.update(req.user, req.params.id, req.body) }); },
    async addInstalment(req, res) { res.status(201).json(await paymentService.addInstalment(req.user, req.params.id, req.body)); },
    async updateInstalment(req, res) { res.status(200).json(await paymentService.updateInstalment(req.user, req.params.id, req.body)); },

    // Raw upload: the body is the file itself (express.raw), the file name comes in the query string (display only).
    async reviewReceipt(req, res) { res.status(200).json({ receipt: await paymentService.reviewReceipt(req.user, req.params.id, req.body) }); },
    async uploadReceipt(req, res) {
      const receipt = await paymentService.uploadReceipt(req.user, req.params.id, {
        body: req.body, contentType: req.headers['content-type'], fileName: req.query.name, confirmDuplicate: req.query.confirmDuplicate === '1'
      });
      res.status(201).json({ receipt });
    },

    // Streams a proof file. Headers make it safe to open in the app's own origin: fixed content type from the sniffed type,
    // no sniffing, no caching, no scripts. PDFs are always downloaded; images may display. The download name is generated,
    // never taken from the uploaded file name.
    async receiptFile(req, res) {
      const f = await paymentService.openReceipt(req.user, req.params.id);
      res.status(200);
      res.set({
        'Content-Type': f.mime,
        'Content-Length': String(f.size),
        'Content-Disposition': `${f.inline ? 'inline' : 'attachment'}; filename="receipt-${f.id}.${f.ext}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox"
      });
      const stream = f.stream();
      stream.on('error', (err) => { console.error('Receipt stream error:', err.code || err.message); res.destroy(err); });
      stream.pipe(res);
    }
  };
}
