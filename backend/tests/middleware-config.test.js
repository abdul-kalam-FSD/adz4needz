import test from "node:test";
import assert from "node:assert/strict";
import {
  createAuthenticate,
  authorize,
} from "../src/middleware/authenticate.js";
import {
  errorHandler,
  requireJsonBody,
  notFound,
} from "../src/middleware/error-handler.js";
import { createAuthHandlers } from "../src/modules/auth/auth.handlers.js";
import { HttpError } from "../src/lib/http-error.js";
import { loadConfig } from "../src/config/env.js";

const run = (mw, req) =>
  new Promise((resolve) => {
    Promise.resolve(mw(req, {}, (err) => resolve(err)));
  });
const fakeRes = () => {
  const r = {
    headers: {},
    body: undefined,
    status(c) {
      r.code = c;
      return r;
    },
    json(b) {
      r.body = b;
      return r;
    },
    end() {
      return r;
    },
    setHeader(k, v) {
      r.headers[k] = v;
    },
  };
  return r;
};

test("authenticate: no cookie -> 401; bad session -> 401; good session sets req.user", async () => {
  const authService = {
    getUserForSession: async (t) =>
      t === "good" ? { id: 1, role: "bde" } : null,
  };
  const auth = createAuthenticate({ authService, cookieName: "bde_session" });
  assert.equal((await run(auth, { headers: {} })).status, 401);
  assert.equal(
    (await run(auth, { headers: { cookie: "bde_session=bad" } })).status,
    401,
  );
  const req = { headers: { cookie: "x=1; bde_session=good" } };
  assert.equal(await run(auth, req), undefined);
  assert.deepEqual(req.user, { id: 1, role: "bde" });
});
test("authenticate passes unexpected errors on (-> 500, not a crash)", async () => {
  const auth = createAuthenticate({
    authService: {
      getUserForSession: async () => {
        throw new Error("db");
      },
    },
    cookieName: "c",
  });
  const err = await run(auth, { headers: { cookie: "c=x" } });
  assert.ok(err instanceof Error && !(err instanceof HttpError));
});
test("authorize: BDE blocked from admin-only route with 403, allowed on own role", async () => {
  assert.equal(
    (await run(authorize("admin"), { user: { role: "bde" } })).status,
    403,
  );
  assert.equal(
    await run(authorize("bde"), { user: { role: "bde" } }),
    undefined,
  );
  assert.equal((await run(authorize("bde"), {})).status, 403);
});
test("requireJsonBody: POST needs application/json; GET does not", async () => {
  assert.equal(
    (
      await run(requireJsonBody, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      })
    ).status,
    415,
  );
  assert.equal(
    (await run(requireJsonBody, { method: "POST", headers: {} })).status,
    415,
  );
  assert.equal(
    await run(requireJsonBody, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
    undefined,
  );
  assert.equal(
    await run(requireJsonBody, { method: "GET", headers: {} }),
    undefined,
  );
});
test("errorHandler: HttpError keeps status/fields; unknown errors become a generic 500 with no details", () => {
  let res = fakeRes();
  errorHandler(new HttpError(409, "X", "msg", { a: "b" }), {}, res, () => {});
  assert.equal(res.code, 409);
  assert.deepEqual(res.body.error.fields, { a: "b" });
  res = fakeRes();
  const quiet = console.error;
  console.error = () => {};
  errorHandler(
    new Error("SECRET connection string mysql://user:pw@host"),
    {},
    res,
    () => {},
  );
  console.error = quiet;
  assert.equal(res.code, 500);
  assert.ok(!JSON.stringify(res.body).includes("SECRET"));
  res = fakeRes();
  errorHandler({ type: "entity.parse.failed" }, {}, res, () => {});
  assert.equal(res.code, 400);
});
test("notFound produces a 404", async () => {
  assert.equal((await run(notFound, {})).status, 404);
});

test("login handler sets an HttpOnly session cookie and never returns the token in the body", async () => {
  const config = {
    sessionTtlHours: 8,
    cookieSecure: true,
    cookieName: "bde_session",
  };
  const authService = {
    login: async () => ({
      token: "TOKEN123",
      user: { id: 1, employeeId: "E", name: "N", role: "bde" },
    }),
  };
  const h = createAuthHandlers({ authService, config });
  const res = fakeRes();
  await h.login({ body: { employeeId: "E", password: "p" } }, res);
  assert.match(
    res.headers["Set-Cookie"],
    /^bde_session=TOKEN123; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure$/,
  );
  assert.ok(!JSON.stringify(res.body).includes("TOKEN123"));
});
test("logout handler clears the cookie and deletes the session", async () => {
  let deleted;
  const h = createAuthHandlers({
    authService: {
      logout: async (t) => {
        deleted = t;
      },
    },
    config: {
      sessionTtlHours: 8,
      cookieSecure: false,
      cookieName: "bde_session",
    },
  });
  const res = fakeRes();
  await h.logout({ headers: { cookie: "bde_session=abc" } }, res);
  assert.equal(deleted, "abc");
  assert.match(res.headers["Set-Cookie"], /Max-Age=0/);
  assert.equal(res.code, 204);
});

test("config: missing DB settings fail with variable NAMES only; defaults applied", () => {
  assert.throws(
    () => loadConfig({}),
    (e) => /DB_HOST, DB_USER, DB_PASSWORD, DB_NAME/.test(e.message),
  );
  const c = loadConfig({
    DB_HOST: "h",
    DB_USER: "u",
    DB_PASSWORD: "SECRETPW",
    DB_NAME: "d",
  });
  assert.equal(c.port, 4000);
  assert.equal(c.sessionTtlHours, 8);
  assert.equal(c.cookieSecure, false);
  assert.equal(
    loadConfig({
      DB_HOST: "h",
      DB_USER: "u",
      DB_PASSWORD: "",
      DB_NAME: "d",
      NODE_ENV: "production",
    }).cookieSecure,
    true,
  );
  assert.throws(
    () =>
      loadConfig({
        DB_HOST: "h",
        DB_USER: "u",
        DB_PASSWORD: "SECRETPW",
        DB_NAME: "d",
        PORT: "abc",
      }),
    (e) => !e.message.includes("SECRETPW"),
  );
});

test('config: DB_SSL enables TLS only when set to "1"', () => {
  const base = {
    DB_HOST: "h",
    DB_USER: "u",
    DB_PASSWORD: "test-password",
    DB_NAME: "d",
  };

  assert.equal(loadConfig(base).db.ssl, false);
  assert.equal(loadConfig({ ...base, DB_SSL: "0" }).db.ssl, false);
  assert.equal(loadConfig({ ...base, DB_SSL: "1" }).db.ssl, true);
});
