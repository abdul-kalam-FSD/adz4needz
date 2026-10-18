// A tiny deterministic model of "login with the OLD password" racing "change password". It is NOT MySQL: it enumerates
// every possible interleaving of the atomic steps of both sides and checks one invariant for each. It shows which
// designs are safe UNDER THE STATED ASSUMPTIONS, nothing more. Real-database proof is tests-integration/login-race.db.test.js.
//
// State: the stored password hash and the set of sessions (the keep-session K belongs to the device changing the password).
//
// Password change P (it verified H_OLD first): P2 delete other sessions, P3 compare-and-set H_OLD -> H_NEW, P4 delete other sessions.
// Login L (it uses the old password): A reads the user row (and verifies the password against what it read).
// Designs of how L then creates its session S:
//   current            : B inserts S                                                  (Phase 5 today)
//   conditional-atomic : B checks "hash still equals what A read" and inserts S as ONE atomic step
//                        (what INSERT ... SELECT gives when its read is a locking read: REPEATABLE READ / SERIALIZABLE)
//   conditional-split  : B1 checks the hash (consistent read), B2 inserts S as a SEPARATE step
//                        (what INSERT ... SELECT amounts to when its read is not locking: READ COMMITTED / READ UNCOMMITTED)
//   insert-then-verify : B inserts S, then C re-reads the user row; if the hash changed, C deletes S and rejects the login

export const H_OLD = 'H_OLD';
export const H_NEW = 'H_NEW';

const loginSteps = {
  'current': ['A', 'B'],
  'conditional-atomic': ['A', 'B'],
  'conditional-split': ['A', 'B1', 'B2'],
  'insert-then-verify': ['A', 'B', 'C']
};

function* interleavings(xs, ys) {
  if (!xs.length) { yield ys.map((s) => ['P', s]); return; }
  if (!ys.length) { yield xs.map((s) => ['L', s]); return; }
  for (const rest of interleavings(xs.slice(1), ys)) yield [['L', xs[0]], ...rest];
  for (const rest of interleavings(xs, ys.slice(1))) yield [['P', ys[0]], ...rest];
}

function run(design, order) {
  const st = { hash: H_OLD, sessions: new Set(['K']) };
  const L = { read: null, aborted: false, accepted: false, ok: null };
  const keepOnly = () => { for (const s of [...st.sessions]) if (s !== 'K') st.sessions.delete(s); };
  for (const [who, step] of order) {
    if (who === 'P') {
      if (step === 'P2' || step === 'P4') keepOnly();
      if (step === 'P3') { if (st.hash === H_OLD) st.hash = H_NEW; }
      continue;
    }
    if (L.aborted) continue;
    if (step === 'A') { L.read = st.hash; if (L.read !== H_OLD) L.aborted = true; continue; } // wrong password against the new hash
    if (design === 'current' && step === 'B') { st.sessions.add('S'); L.accepted = true; }
    if (design === 'conditional-atomic' && step === 'B') { if (st.hash === L.read) { st.sessions.add('S'); L.accepted = true; } else L.aborted = true; }
    if (design === 'conditional-split' && step === 'B1') L.ok = st.hash === L.read;
    if (design === 'conditional-split' && step === 'B2') { if (L.ok) { st.sessions.add('S'); L.accepted = true; } else L.aborted = true; }
    if (design === 'insert-then-verify' && step === 'B') st.sessions.add('S');
    if (design === 'insert-then-verify' && step === 'C') { if (st.hash === L.read) L.accepted = true; else { st.sessions.delete('S'); L.aborted = true; } }
  }
  return { st, L };
}

// Violation: the login was accepted with the old password, the password has since changed, and its session still exists.
const violates = ({ st, L }) => L.accepted && st.hash !== L.read && st.sessions.has('S');
// Orphan: a session row exists although the login was refused (harmless: nobody ever receives that token).
const orphan = ({ st, L }) => !L.accepted && st.sessions.has('S');

export function check(design, { skipP4 = false } = {}) {
  const P = skipP4 ? ['P2', 'P3'] : ['P2', 'P3', 'P4'];
  let total = 0; const violations = []; const orphans = [];
  for (const order of interleavings(loginSteps[design], P)) {
    total += 1;
    const r = run(design, order);
    const label = order.map(([w, s]) => s).join(' ');
    if (violates(r)) violations.push(label);
    if (orphan(r)) orphans.push(label);
  }
  return { design, total, violations, orphans };
}
export const DESIGNS = Object.keys(loginSteps);
