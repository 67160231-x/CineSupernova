// เทสต์ระบบ "ลืมรหัสผ่าน" บน Supabase จำลองในหน่วยความจำ (ไม่ต่อ Supabase จริง และไม่ส่งอีเมลจริง)
const test = require('node:test');
const assert = require('node:assert/strict');
const { installMemorySupabase } = require('./helpers/memory-supabase');

const db = installMemorySupabase();
process.env.APP_BASE_URL = 'https://cine.example.test/';
process.env.JWT_SECRET = 'test-secret';
delete process.env.PASSWORD_RESET_DEMO;
delete process.env.BREVO_API_KEY;
delete process.env.RESEND_API_KEY;

const auth = require('../auth');
const reset = require('../password-reset');
const { sendMail } = require('../mailer');
const { createServer } = require('../server');

let n = 0;
async function newUser(prefix = 'u') {
  n += 1;
  const username = `${prefix}${n}`;
  const email = `${username}@Test.dev`;
  await auth.register({ username, email, password: 'oldpass1' });
  return { username, email };
}
function mailbox() {
  const sent = [];
  return { sent, send: async (mail) => { sent.push(mail); return { provider: 'fake', delivered: true }; } };
}
const tokenOf = (mail) => new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
const rows = () => db.__tables.password_resets;

test('อีเมลที่ไม่มีในระบบ: ตอบข้อความเดียวกับอีเมลที่มี และไม่สร้าง token / ไม่ส่งอีเมล', async () => {
  const box = mailbox();
  const r = await reset.requestPasswordReset({ email: 'ghost@nowhere.dev' }, { send: box.send });
  assert.equal(r.message, reset.GENERIC_MESSAGE);
  assert.equal(r.demoResetLink, undefined);
  assert.equal(box.sent.length, 0);
  assert.equal(rows().length, 0);
});

test('อีเมลที่มีในระบบ: ส่งลิงก์ทางอีเมล เก็บเฉพาะ hash ของ token และไม่โชว์ลิงก์ในคำตอบ', async () => {
  const u = await newUser();
  const box = mailbox();
  const r = await reset.requestPasswordReset({ email: u.email.toLowerCase() }, { send: box.send }); // พิมพ์ตัวเล็กก็เจอ
  assert.equal(r.message, reset.GENERIC_MESSAGE);
  assert.equal(r.demoResetLink, undefined, 'โหมดปกติห้ามคืนลิงก์ให้หน้าเว็บ');
  assert.equal(box.sent.length, 1);
  const mail = box.sent[0];
  assert.equal(mail.to, u.email);
  assert.match(mail.text, /^https?:\/\/|reset-password\.html\?token=/m);
  assert.ok(mail.text.includes('https://cine.example.test/reset-password.html?token='), 'ใช้ APP_BASE_URL และตัด / ท้ายออก');
  assert.ok(mail.html.includes(u.username));
  const token = tokenOf(mail);
  assert.ok(token.length >= 40);
  assert.ok(rows().every((x) => x.token_hash !== token), 'ต้องไม่เก็บ token ตัวจริงในฐานข้อมูล');
  assert.equal(rows().filter((x) => x.user_id === (db.__tables.users.find((y) => y.username === u.username).id)).length, 1);
});

test('อีเมลที่มี _ หรือ %: ค้นตรงตัวอักษร ไม่ตีความเป็น wildcard (ไม่ส่งไปหาคนอื่น)', async () => {
  await auth.register({ username: 'underscore_user', email: 'a_b@x.dev', password: 'oldpass1' });
  await auth.register({ username: 'plain_user', email: 'axb@x.dev', password: 'oldpass1' });
  const box = mailbox();
  await reset.requestPasswordReset({ email: 'A_B@x.dev' }, { send: box.send });
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, 'a_b@x.dev');
  const box2 = mailbox();
  await reset.requestPasswordReset({ email: 'a%@x.dev' }, { send: box2.send });
  assert.equal(box2.sent.length, 0, '% ต้องไม่กลายเป็น wildcard');
});

test('รีเซ็ตสำเร็จ: เปลี่ยนรหัส, รหัสเก่าใช้ไม่ได้, session เก่าถูกเตะออก, ลิงก์ใช้ได้ครั้งเดียว', async () => {
  const u = await newUser();
  const oldSession = await auth.login({ username: u.username, password: 'oldpass1' });
  const box = mailbox();
  await reset.requestPasswordReset({ email: u.email }, { send: box.send });
  const token = tokenOf(box.sent[0]);

  assert.equal(await reset.checkResetToken(token), true);
  const ok = await reset.resetPassword({ token, newPassword: 'brandnew9' });
  assert.match(ok.message, /สำเร็จ/);

  await assert.rejects(() => auth.login({ username: u.username, password: 'oldpass1' }), (e) => e.status === 401);
  const fresh = await auth.login({ username: u.username, password: 'brandnew9' });
  assert.ok(fresh.token);
  await assert.rejects(() => auth.verifyToken(oldSession.token), (e) => e.status === 401, 'session เก่าต้องใช้ไม่ได้');

  assert.equal(await reset.checkResetToken(token), false);
  await assert.rejects(() => reset.resetPassword({ token, newPassword: 'another99' }), (e) => e.status === 400);
});

test('ขอลิงก์ใหม่: ลิงก์เก่าใช้ไม่ได้ เหลือเฉพาะลิงก์ล่าสุด', async () => {
  const u = await newUser();
  const box = mailbox();
  await reset.requestPasswordReset({ email: u.email }, { send: box.send });
  await reset.requestPasswordReset({ email: u.email }, { send: box.send });
  const [first, second] = box.sent.map(tokenOf);
  assert.equal(await reset.checkResetToken(first), false);
  assert.equal(await reset.checkResetToken(second), true);
});

test('ลิงก์หมดอายุหลัง 30 นาที', async () => {
  const u = await newUser();
  const box = mailbox();
  await reset.requestPasswordReset({ email: u.email }, { send: box.send });
  const token = tokenOf(box.sent[0]);
  const later = () => Date.now() + 31 * 60 * 1000;
  assert.equal(await reset.checkResetToken(token, { now: later }), false);
  await assert.rejects(() => reset.resetPassword({ token, newPassword: 'newpass22' }, { now: later }), (e) => e.status === 400 && /หมดอายุ/.test(e.message));
  assert.equal(await reset.checkResetToken(token), true, 'ก่อนครบ 30 นาทียังใช้ได้');
});

test('รหัสใหม่สั้นไป = 400 และไม่เปลืองลิงก์ (ยังใช้ต่อได้)', async () => {
  const u = await newUser();
  const box = mailbox();
  await reset.requestPasswordReset({ email: u.email }, { send: box.send });
  const token = tokenOf(box.sent[0]);
  await assert.rejects(() => reset.resetPassword({ token, newPassword: '123' }), (e) => e.status === 400);
  await assert.rejects(() => reset.resetPassword({ token, newPassword: undefined }), (e) => e.status === 400);
  assert.equal(await reset.checkResetToken(token), true);
  await reset.resetPassword({ token, newPassword: 'longenough' });
});

test('token มั่ว / ว่าง / สั้น = ไม่ผ่าน', async () => {
  for (const t of [undefined, '', 'abc', 'x'.repeat(60), 'x'.repeat(500)]) {
    assert.equal(await reset.checkResetToken(t), false);
    await assert.rejects(() => reset.resetPassword({ token: t, newPassword: 'longenough' }), (e) => e.status === 400);
  }
});

test('จำกัดการขอ: ขอเกิน 3 ครั้งใน 15 นาที ไม่ส่งอีเมลเพิ่ม (แต่ยังตอบเหมือนเดิม)', async () => {
  const u = await newUser();
  const box = mailbox();
  for (let i = 0; i < 5; i += 1) {
    const r = await reset.requestPasswordReset({ email: u.email }, { send: box.send });
    assert.equal(r.message, reset.GENERIC_MESSAGE);
  }
  assert.equal(box.sent.length, 3);
});

test('อีเมลว่าง/รูปแบบผิด = 400', async () => {
  for (const email of [undefined, '', '   ', 'not-an-email', 'a@b', 'a b@c.dev', 123]) {
    await assert.rejects(() => reset.requestPasswordReset({ email }, { send: async () => ({}) }), (e) => e.status === 400);
  }
});

test('ส่งอีเมลล้มเหลว: ไม่พังและไม่บอกผู้ใช้ (ตอบเหมือนปกติ)', async () => {
  const u = await newUser();
  const origError = console.error; console.error = () => {};
  try {
    const r = await reset.requestPasswordReset({ email: u.email }, { send: async () => { throw new Error('provider down'); } });
    assert.equal(r.message, reset.GENERIC_MESSAGE);
  } finally { console.error = origError; }
});

test('โหมดสาธิต (PASSWORD_RESET_DEMO=true) คืนลิงก์ให้หน้าเว็บ แต่เฉพาะอีเมลที่มีในระบบ', async () => {
  const u = await newUser();
  const box = mailbox();
  const env = { ...process.env, PASSWORD_RESET_DEMO: 'true' };
  const r = await reset.requestPasswordReset({ email: u.email }, { send: box.send, env });
  assert.ok(r.demoResetLink.startsWith('https://cine.example.test/reset-password.html?token='));
  const ghost = await reset.requestPasswordReset({ email: 'nobody@x.dev' }, { send: box.send, env });
  assert.equal(ghost.demoResetLink, undefined);
});

test('ลิงก์อีเมล: ไม่ตั้ง APP_BASE_URL บน production = ไม่ส่ง / บน dev ใช้ origin ของคำขอ', async () => {
  assert.equal(reset.resolveBaseUrl('http://localhost:3000', { NODE_ENV: 'production' }), null);
  assert.equal(reset.resolveBaseUrl('http://localhost:3000/', {}), 'http://localhost:3000');
  assert.equal(reset.resolveBaseUrl('http://evil.test', { NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://app.onrender.com/' }), 'https://app.onrender.com');
  assert.equal(reset.resolveBaseUrl('http://evil.test', { APP_BASE_URL: 'https://mine.dev' }), 'https://mine.dev');

  const u = await newUser();
  const box = mailbox();
  const origError = console.error; console.error = () => {};
  try {
    const r = await reset.requestPasswordReset({ email: u.email }, { send: box.send, env: { NODE_ENV: 'production' } });
    assert.equal(r.message, reset.GENERIC_MESSAGE);
    assert.equal(box.sent.length, 0);
  } finally { console.error = origError; }
});

test('ยังไม่ได้สร้างตาราง password_resets: แจ้งให้รัน migration อย่างชัดเจน', async () => {
  const u = await newUser();
  db.__dropTable('password_resets');
  await assert.rejects(
    () => reset.requestPasswordReset({ email: u.email }, { send: async () => ({}) }),
    (e) => e.status === 500 && /migration_password_reset\.sql/.test(e.message)
  );
  db.__dropTable('password_resets', false);
});

test('mailer: รูปแบบคำขอของ Brevo / Resend และกรณีไม่ได้ตั้งค่า', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: true, status: 201, text: async () => '' }; };
  const mail = { to: 'a@x.dev', subject: 'S', text: 'T', html: '<b>H</b>' };

  const none = await sendMail(mail, { env: {}, fetchImpl });
  assert.deepEqual(none, { provider: 'none', delivered: false });
  assert.equal(calls.length, 0);

  const brevo = await sendMail(mail, { env: { BREVO_API_KEY: 'k1', MAIL_FROM_EMAIL: 'me@x.dev', MAIL_FROM_NAME: 'Cine' }, fetchImpl });
  assert.equal(brevo.provider, 'brevo');
  assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[0].opts.headers['api-key'], 'k1');
  assert.deepEqual(calls[0].body.sender, { name: 'Cine', email: 'me@x.dev' });
  assert.deepEqual(calls[0].body.to, [{ email: 'a@x.dev' }]);
  assert.equal(calls[0].body.htmlContent, '<b>H</b>');

  const resend = await sendMail(mail, { env: { RESEND_API_KEY: 'k2' }, fetchImpl });
  assert.equal(resend.provider, 'resend');
  assert.equal(calls[1].url, 'https://api.resend.com/emails');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer k2');
  assert.deepEqual(calls[1].body.to, ['a@x.dev']);

  const bad = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  await assert.rejects(() => sendMail(mail, { env: { RESEND_API_KEY: 'x' }, fetchImpl: bad }), /HTTP 401/);
});

test('HTTP: /api/forgot-password → /api/reset-password/check → /api/reset-password → ล็อกอินด้วยรหัสใหม่', async () => {
  process.env.PASSWORD_RESET_DEMO = 'true';
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    const u = await newUser('http');
    assert.equal((await call('POST', '/api/forgot-password', { email: '' })).status, 400);
    const ghost = await call('POST', '/api/forgot-password', { email: 'ghost@x.dev' });
    assert.equal(ghost.status, 200);
    assert.equal(ghost.body.demoResetLink, undefined);

    const f = await call('POST', '/api/forgot-password', { email: u.email });
    assert.equal(f.status, 200);
    const token = new URL(f.body.demoResetLink).searchParams.get('token');

    assert.deepEqual((await call('GET', `/api/reset-password/check?token=${token}`)).body, { valid: true });
    assert.deepEqual((await call('GET', '/api/reset-password/check?token=nope')).body, { valid: false });
    assert.equal((await call('POST', '/api/reset-password', { token, newPassword: '12' })).status, 400);
    const done = await call('POST', '/api/reset-password', { token, newPassword: 'fresh-pass-7' });
    assert.equal(done.status, 200);
    assert.equal((await call('POST', '/api/reset-password', { token, newPassword: 'fresh-pass-8' })).status, 400);
    assert.equal((await call('POST', '/api/login', { username: u.username, password: 'oldpass1' })).status, 401);
    assert.equal((await call('POST', '/api/login', { username: u.username, password: 'fresh-pass-7' })).status, 200);
  } finally {
    delete process.env.PASSWORD_RESET_DEMO;
    await new Promise((resolve) => server.close(resolve));
  }
});
