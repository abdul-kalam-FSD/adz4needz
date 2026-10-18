import { createHash } from 'node:crypto';
import { HttpError } from '../../lib/http-error.js';
import { validatePayment, validateInstalment } from '../../lib/validate-payment.js';
import { parsePaymentQuery, parsePaymentRangeQuery } from '../../lib/payment-query.js';
import { formatMoney, fromDecimalString, paymentStatus } from '../../lib/money.js';
import { ALLOWED_RECEIPT_MIME, MAX_RECEIPTS_PER_INSTALMENT, RECEIPT_TYPES, declaredMime, sanitizeFileName, sniffReceiptType } from '../../lib/receipt-file.js';

const isBde = (actor) => actor && actor.role === 'bde';
const isAdmin = (actor) => actor && actor.role === 'admin';
const sameId = (a, b) => Number(a) === Number(b);

function requireViewer(actor) {
  if (!isBde(actor) && !isAdmin(actor)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
}
function requireBde(actor) {
  // Admin screens are read-only: only the owning BDE records payments, instalments and receipts.
  if (!isBde(actor)) throw new HttpError(403, 'FORBIDDEN', 'Only the BDE who owns the lead can record or change its payments.');
}
function requireAdmin(actor) {
  if (!isAdmin(actor)) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this resource.');
}
const scopeFor = (actor) => (isBde(actor) ? actor.id : null); // BDE -> own id; Admin -> null (whole team)
const validationError = (errors) => new HttpError(400, 'VALIDATION_ERROR', 'Please fix the highlighted fields.', errors);

function parseId(idText, what) {
  if (typeof idText !== 'string' || !/^[1-9]\d{0,17}$/.test(idText)) throw new HttpError(400, 'VALIDATION_ERROR', `Invalid ${what} id.`);
  return idText;
}

function toPayment(r, actor) {
  const committed = fromDecimalString(r.amount_committed);
  const paid = fromDecimalString(r.paid_amount);
  const payment = {
    id: r.id,
    lead: { id: r.lead_id, candidateName: r.candidate_name, courseOrInternship: r.lead_course, phone: r.phone, email: r.email },
    courseOrInternship: r.course_or_internship,
    amountCommitted: formatMoney(committed),
    amountPaid: formatMoney(paid),
    amountOutstanding: formatMoney(committed - paid),
    status: paymentStatus(committed, paid), // derived, never stored
    commitmentDate: r.commitment_date,
    instalmentCount: Number(r.instalment_count),
    receiptCount: Number(r.receipt_count),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
  if (isAdmin(actor)) payment.bde = { id: r.user_id, employeeId: r.bde_employee_id, name: r.bde_name };
  return payment;
}

// Review state of one proof, as shown to both roles. A proof nobody has looked at is 'pending'.
function toReview(r) {
  return {
    reviewStatus: r.review_status || 'pending', reviewNote: r.review_note || null, reviewedAt: r.reviewed_at || null,
    reviewedBy: r.reviewer_name ? { name: r.reviewer_name, employeeId: r.reviewer_employee_id } : null
  };
}
export const REVIEW_DECISIONS = ['approved', 'rejected'];
const NOTE_CONTROL = /[\u0000-\u001F\u007F]/;

// Groups the instalment/receipt join rows. Only metadata is exposed: never the stored file name or any disk path.
function toInstalments(rows) {
  const list = []; const byId = new Map();
  for (const r of rows) {
    let inst = byId.get(String(r.instalment_id));
    if (!inst) {
      inst = { id: r.instalment_id, amount: formatMoney(fromDecimalString(r.amount)), paidOn: r.paid_on, createdAt: r.instalment_created_at, receipts: [] };
      byId.set(String(r.instalment_id), inst); list.push(inst);
    }
    if (r.receipt_id) inst.receipts.push({ id: r.receipt_id, originalName: r.original_name, mimeType: r.mime_type, sizeBytes: Number(r.size_bytes), uploadedAt: r.uploaded_at, ...toReview(r) });
  }
  return list;
}

// One BDE row of the aggregate query -> API shape + BigInt contributions to the team total.
const ZERO = () => ({ payments: 0, committed: 0n, paidToward: 0n, pending: 0, partiallyPaid: 0, paid: 0, completed: 0n, instalments: 0, received: 0n });
function numbers(r) {
  return { payments: Number(r.payments), committed: fromDecimalString(r.committed), paidToward: fromDecimalString(r.paid_toward), pending: Number(r.pending),
    partiallyPaid: Number(r.partially_paid), paid: Number(r.paid_count), completed: fromDecimalString(r.paid_committed), instalments: Number(r.instalments), received: fromDecimalString(r.received) };
}
function shape(n) {
  return { payments: n.payments, committed: formatMoney(n.committed), outstanding: formatMoney(n.committed - n.paidToward), pending: n.pending, partiallyPaid: n.partiallyPaid,
    paid: n.paid, completedAmount: formatMoney(n.completed), instalments: n.instalments, received: formatMoney(n.received) };
}

export function createPaymentService({ repo, storage, maxBytes }) {
  return {
    receiptRules: () => ({ maxBytes, allowedTypes: ALLOWED_RECEIPT_MIME, maxPerInstalment: MAX_RECEIPTS_PER_INSTALMENT }),

    async list(actor, query) {
      requireViewer(actor);
      const parsed = parsePaymentQuery(query, { admin: isAdmin(actor) });
      if (!parsed.ok) throw validationError(parsed.errors);
      const filters = parsed.value;
      const { rows, total } = await repo.search({ scopeUserId: scopeFor(actor), filters });
      return { payments: rows.map((r) => toPayment(r, actor)), total, page: filters.page, pageSize: filters.pageSize };
    },

    // BDE: own totals. (Admin uses overview().)
    async summary(actor, query) {
      requireBde(actor);
      const parsed = parsePaymentRangeQuery(query);
      if (!parsed.ok) throw validationError(parsed.errors);
      const rows = await repo.overview({ range: parsed.value, scopeUserId: actor.id });
      const c = await repo.proofCounts(actor.id);
      return { range: parsed.value, totals: shape(rows[0] ? numbers(rows[0]) : ZERO()), proofs: { awaitingReview: c.pending, approved: c.approved, rejected: c.rejected } };
    },

    // Admin only: one row per BDE plus team totals. "committed" counts commitments dated in the range; "received" counts
    // instalments paid in the range (so it can include instalments against earlier commitments). Every instalment and every
    // commitment is counted exactly once.
    async overview(actor, query) {
      requireAdmin(actor);
      const parsed = parsePaymentRangeQuery(query);
      if (!parsed.ok) throw validationError(parsed.errors);
      const rows = await repo.overview({ range: parsed.value, scopeUserId: null });
      const sum = ZERO();
      const bdes = rows.map((r) => {
        const n = numbers(r);
        for (const k of Object.keys(sum)) sum[k] += n[k];
        return { id: r.id, employeeId: r.employee_id, name: r.name, isActive: Boolean(r.is_active), ...shape(n) };
      });
      return { range: parsed.value, totals: shape(sum), bdes };
    },

    async get(actor, idText) {
      requireViewer(actor);
      const id = parseId(idText, 'payment');
      const row = await repo.findPaymentById(id, scopeFor(actor)); // a BDE asking for someone else's payment gets 404, not 403
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Payment not found.');
      return { ...toPayment(row, actor), instalments: toInstalments(await repo.listInstalments(row.id)), receiptRules: this.receiptRules() };
    },

    async create(actor, body) {
      requireBde(actor);
      const result = validatePayment(body, { forCreate: true });
      if (!result.ok) throw validationError(result.errors);
      const v = result.value;
      // Missing lead and another BDE's lead give the same answer, so lead ids cannot be probed.
      const lead = await repo.findOwnLead(v.leadId, actor.id);
      if (!lead) throw new HttpError(404, 'NOT_FOUND', 'Lead not found.');
      const id = await repo.insertPayment(lead.id, actor.id, v); // owner always comes from the session, never from the body
      return toPayment(await repo.findPaymentById(id, actor.id), actor);
    },

    async update(actor, idText, body) {
      requireBde(actor);
      const id = parseId(idText, 'payment');
      if (!(await repo.findPaymentById(id, actor.id))) throw new HttpError(404, 'NOT_FOUND', 'Payment not found.');
      const result = validatePayment(body, { forCreate: false });
      if (!result.ok) throw validationError(result.errors);
      const out = await repo.updatePayment(id, actor.id, result.value);
      if (!out.ok && out.reason === 'BELOW_PAID') throw validationError({ amountCommitted: `Committed amount cannot be less than the ${formatMoney(out.paid)} already received.` });
      if (!out.ok) throw new HttpError(404, 'NOT_FOUND', 'Payment not found.');
      return toPayment(await repo.findPaymentById(id, actor.id), actor);
    },

    async addInstalment(actor, paymentIdText, body) {
      requireBde(actor);
      const paymentId = parseId(paymentIdText, 'payment');
      if (!(await repo.findPaymentById(paymentId, actor.id))) throw new HttpError(404, 'NOT_FOUND', 'Payment not found.');
      const result = validateInstalment(body);
      if (!result.ok) throw validationError(result.errors);
      const v = result.value;
      const out = await repo.addInstalment({ paymentId, userId: actor.id, amount: v.amount, paidOn: v.paidOn, confirmDuplicate: v.confirmDuplicate });
      return this._instalmentResult(actor, paymentId, out, v);
    },

    async updateInstalment(actor, idText, body) {
      requireBde(actor);
      const id = parseId(idText, 'instalment');
      const existing = await repo.findInstalment(id, actor.id);
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Instalment not found.');
      const result = validateInstalment(body);
      if (!result.ok) throw validationError(result.errors);
      const v = result.value;
      const out = await repo.updateInstalment({ id, userId: actor.id, amount: v.amount, paidOn: v.paidOn, confirmDuplicate: v.confirmDuplicate });
      return this._instalmentResult(actor, existing.payment_id, out, v, id);
    },

    async _instalmentResult(actor, paymentId, out, v, knownId) {
      if (!out.ok && out.reason === 'DUPLICATE') {
        throw new HttpError(409, 'POSSIBLE_DUPLICATE_INSTALMENT',
          'An instalment with the same amount and date already exists for this payment. If this is a different payment, confirm to save it. Nothing has been merged.',
          undefined, { existingInstalmentId: out.existingId });
      }
      if (!out.ok && out.reason === 'OVER') throw validationError({ amount: `Amount exceeds the outstanding balance of ${formatMoney(out.outstanding)}.` });
      if (!out.ok) throw new HttpError(404, 'NOT_FOUND', 'Payment not found.');
      const payment = toPayment(await repo.findPaymentById(paymentId, actor.id), actor);
      return { instalment: { id: knownId || out.id, amount: formatMoney(v.amount), paidOn: v.paidOn }, payment };
    },

    // body must be a Buffer (the raw upload). All checks happen before anything is written to disk.
    async uploadReceipt(actor, instalmentIdText, { body, contentType, fileName, confirmDuplicate }) {
      requireBde(actor);
      const instalmentId = parseId(instalmentIdText, 'instalment');
      const inst = await repo.findInstalment(instalmentId, actor.id); // another BDE's instalment looks like "not found"
      if (!inst) throw new HttpError(404, 'NOT_FOUND', 'Instalment not found.');
      if (!Buffer.isBuffer(body)) throw new HttpError(415, 'INVALID_FILE_TYPE', 'Send the file itself with Content-Type image/jpeg, image/png or application/pdf.');
      if (body.length === 0) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty.');
      if (body.length > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `The file is larger than the limit of ${Math.floor(maxBytes / 1024)} KB.`);
      const sniffed = sniffReceiptType(body);
      if (!sniffed) throw new HttpError(415, 'INVALID_FILE_TYPE', 'Only JPEG, PNG or PDF files are accepted, and the file content must match.');
      if (declaredMime(contentType) !== sniffed) throw new HttpError(415, 'INVALID_FILE_TYPE', 'The file content does not match the declared file type.');
      if (await repo.countReceipts(instalmentId) >= MAX_RECEIPTS_PER_INSTALMENT) {
        throw new HttpError(409, 'TOO_MANY_RECEIPTS', `At most ${MAX_RECEIPTS_PER_INSTALMENT} files can be attached to one instalment.`);
      }
      const sha256 = createHash('sha256').update(body).digest('hex');
      if (!confirmDuplicate) {
        const same = await repo.findReceiptsByHash(sha256);
        if (same.length) {
          const own = same.filter((s) => sameId(s.user_id, actor.id)).map((s) => ({ receiptId: s.id, instalmentId: s.instalment_id }));
          throw new HttpError(409, 'POSSIBLE_DUPLICATE_RECEIPT', 'This exact file is already attached to a payment. If it is genuinely the proof for this instalment, confirm to attach it again. Nothing has been merged.',
            undefined, { own, otherBdeMatches: same.length - own.length }); // other BDEs' records are only counted, never described
        }
      }
      const storedName = await storage.save(body, RECEIPT_TYPES[sniffed].ext);
      try {
        const originalName = sanitizeFileName(fileName);
        const id = await repo.insertReceipt({ instalmentId, userId: actor.id, originalName, storedName, mimeType: sniffed, sizeBytes: body.length, sha256 });
        return { id, originalName, mimeType: sniffed, sizeBytes: body.length };
      } catch (err) {
        await storage.remove(storedName).catch(() => {}); // no orphan file when the database write fails
        throw err;
      }
    },

    // Admin approves or rejects ONE proof. Rejection needs a note (the BDE sees it). Re-reviewing replaces the previous decision.
    async reviewReceipt(actor, idText, body) {
      requireAdmin(actor);
      const id = parseId(idText, 'receipt');
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw validationError({ _form: 'Request body must be a JSON object.' });
      const errors = {};
      if (!REVIEW_DECISIONS.includes(body.decision)) errors.decision = 'Choose Approve or Reject.';
      let note = null;
      if (body.note !== undefined && body.note !== null && body.note !== '') {
        if (typeof body.note !== 'string' || NOTE_CONTROL.test(body.note) || body.note.trim().length > 300) errors.note = 'Note must be plain text of at most 300 characters.';
        else note = body.note.trim() || null;
      }
      if (body.decision === 'rejected' && !note && !errors.note) errors.note = 'Give a reason for rejecting this proof, so the BDE knows what to fix.';
      if (Object.keys(errors).length) throw validationError(errors);
      if (!(await repo.reviewReceipt({ id, decision: body.decision, note, reviewerId: actor.id }))) throw new HttpError(404, 'NOT_FOUND', 'Receipt not found.');
      const row = await repo.findReceiptReview(id);
      return { id: Number(row.id), ...toReview(row) };
    },

    // Returns what the handler needs to stream one proof file. BDE: own only (else 404). Admin: any.
    async openReceipt(actor, idText) {
      requireViewer(actor);
      const id = parseId(idText, 'receipt');
      const rec = await repo.findReceipt(id, scopeFor(actor));
      if (!rec) throw new HttpError(404, 'NOT_FOUND', 'Receipt not found.');
      let st;
      try { st = await storage.stat(rec.stored_name); } catch (err) {
        console.error('Receipt file missing on disk for receipt', rec.id, err.code || err.message); // server log only
        throw new HttpError(404, 'NOT_FOUND', 'The receipt file is not available.');
      }
      const type = RECEIPT_TYPES[rec.mime_type];
      return { id: rec.id, mime: rec.mime_type, ext: type.ext, inline: type.inline, size: st.size, stream: () => storage.openRead(rec.stored_name) };
    }
  };
}
