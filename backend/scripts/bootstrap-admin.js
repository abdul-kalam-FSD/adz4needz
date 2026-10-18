// Creates the FIRST administrator, and only while no administrator exists. Run this on the server, in a shell, once.
// The password is typed at a hidden prompt (never in code, arguments, environment or logs).
// Usage: npm run bootstrap-admin -- --employee-id <ID> --name "<Full Name>"
// After the first admin exists this command refuses to do anything. Further BDE accounts are created by that admin in the app
// (Admin > Employees). Additional admins, if ever needed, are still created with `npm run create-user -- --role admin ...`.
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/pool.js';
import { bootstrapFirstAdmin, BootstrapError } from '../src/lib/bootstrap-admin.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    let muted = false;
    const out = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); } });
    const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
    process.stdout.write(question);
    muted = true;
    rl.question('', (answer) => { muted = false; rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const employeeId = (arg('employee-id') || '').trim();
const name = (arg('name') || '').trim();
if (employeeId === '' || name === '') {
  console.error('Usage: npm run bootstrap-admin -- --employee-id <1-32 letters/digits/._-> --name "<Full Name>"');
  process.exit(1);
}

let config;
try { config = loadConfig(); } catch (err) { console.error('Configuration error:', err.message); process.exit(1); }

const password = await promptHidden('Password: ');
const confirm = await promptHidden('Confirm password: ');
if (password !== confirm) { console.error('Passwords do not match.'); process.exit(1); }

const db = createDb(config.db);
try {
  const admin = await bootstrapFirstAdmin({ db, employeeId, name, password });
  console.log(`Created the first admin account for employee ID ${admin.employeeId}. Sign in with the Admin Sign In tab.`);
} catch (err) {
  if (err instanceof BootstrapError) {
    console.error(err.message);
    for (const m of Object.values(err.fields)) console.error(' - ' + m);
  } else {
    console.error(`Failed: ${err.code || err.message}`);
  }
  process.exitCode = 1;
} finally {
  await db.close();
}
