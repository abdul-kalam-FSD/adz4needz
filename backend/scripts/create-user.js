// Creates a BDE or admin account. The password is typed at a hidden prompt (never in code, args or env).
// Usage: npm run create-user -- --role admin --employee-id <ID> --name "<Full Name>"
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/db/pool.js';
import { hashPassword, MAX_PASSWORD_LENGTH } from '../src/lib/password.js';

const MIN_PASSWORD_LENGTH = 10; // technical default; password policy needs TL confirmation

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

const role = arg('role');
const employeeId = (arg('employee-id') || '').trim();
const name = (arg('name') || '').trim();

if (!['bde', 'admin'].includes(role) || !/^[A-Za-z0-9._-]{1,32}$/.test(employeeId) || name === '' || name.length > 120) {
  console.error('Usage: npm run create-user -- --role <bde|admin> --employee-id <1-32 letters/digits/._-> --name "<Full Name>"');
  process.exit(1);
}

let config;
try { config = loadConfig(); } catch (err) { console.error('Configuration error:', err.message); process.exit(1); }

const password = await promptHidden('Password: ');
const confirm = await promptHidden('Confirm password: ');
if (password !== confirm) { console.error('Passwords do not match.'); process.exit(1); }
if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
  console.error(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}

const db = createDb(config.db);
try {
  await db.query(
    'INSERT INTO users (employee_id, name, password_hash, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP())',
    [employeeId, name, await hashPassword(password), role]
  );
  console.log(`Created ${role} account for employee ID ${employeeId}.`);
} catch (err) {
  console.error(err.code === 'ER_DUP_ENTRY' ? `Employee ID ${employeeId} already exists.` : `Failed: ${err.code || err.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
