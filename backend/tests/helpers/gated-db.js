// Deterministic coordination for concurrency tests: no sleeps, no timing. A rule pauses a database call at an exact
// statement boundary (before or after it runs) until the test releases it.
export function deferred() {
  let resolve; let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
// Only a safety net so a mistake in a scenario fails with a message instead of hanging the test run.
export const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for ' + label)), ms).unref())
]);
// rules: [{ match: RegExp, nth?: 1-based occurrence (default 1), before?: async (sql, params), after?: async (sql, params, result) }]
export function gatedDb(inner, rules) {
  const counts = rules.map(() => 0);
  return {
    async query(sql, params = []) {
      const hits = [];
      rules.forEach((rule, i) => { if (rule.match.test(sql)) { counts[i] += 1; if (counts[i] === (rule.nth || 1)) hits.push(rule); } });
      for (const rule of hits) if (rule.before) await rule.before(sql, params);
      const result = await inner.query(sql, params);
      for (const rule of hits) if (rule.after) await rule.after(sql, params, result);
      return result;
    },
    close: inner.close ? () => inner.close() : undefined
  };
}
