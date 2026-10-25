// เทสต์ตัวส่งอีเมลส่วนที่เพิ่มมา: Gmail ผ่าน Google Apps Script + เทมเพลตเมล
// (Brevo / Resend / กรณีไม่ได้ตั้งค่า เทสต์อยู่ใน password-reset.test.js)
// จำลอง Apps Script ด้วย server ในเครื่อง — Apps Script จริงตอบ 302 redirect ก่อนส่ง JSON กลับ
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const mailer = require('../mailer');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

const message = mailer.passwordResetEmail({ to: 'a@example.com', username: '<b>x</b>', link: 'https://cine.example.com/reset-password.html?token=abc', minutes: 30 });

test('เทมเพลตเมล escape HTML ของชื่อผู้ใช้ และมีลิงก์ในเนื้อหาแบบข้อความ', () => {
  assert.ok(message.html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(!message.html.includes('<b>x</b>'));
  assert.ok(message.text.includes('https://cine.example.com/reset-password.html?token=abc'));
  const changed = mailer.passwordChangedEmail({ to: 'a@example.com', username: 'x', via: 'reset', forgotUrl: 'https://cine.example.com/login.html?forgot=1' });
  assert.match(changed.subject, /ถูกเปลี่ยนแล้ว/);
  assert.ok(changed.text.includes('login.html?forgot=1'));
});

test('appUrl: ใช้ APP_URL ก่อน แล้ว APP_BASE_URL แล้ว RENDER_EXTERNAL_URL และตัด / ท้าย', () => {
  assert.equal(mailer.appUrl({ APP_URL: 'https://a.dev/', APP_BASE_URL: 'https://b.dev' }), 'https://a.dev');
  assert.equal(mailer.appUrl({ APP_BASE_URL: 'https://b.dev//' }), 'https://b.dev');
  assert.equal(mailer.appUrl({ RENDER_EXTERNAL_URL: 'https://r.onrender.com' }), 'https://r.onrender.com');
  assert.equal(mailer.appUrl({}), 'http://localhost:3000');
});

test('getProvider: Gmail Apps Script มาก่อน Brevo / Brevo ต้องมีอีเมลผู้ส่ง', () => {
  assert.equal(mailer.getProvider({ GMAIL_SCRIPT_URL: 'https://x/exec', BREVO_API_KEY: 'k', MAIL_FROM_EMAIL: 'a@b.c' }), 'gmail-script');
  assert.equal(mailer.getProvider({ BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.c' }), 'brevo');
  assert.equal(mailer.getProvider({ BREVO_API_KEY: 'k' }), 'none');
  assert.equal(mailer.getProvider({}), 'none');
});

test('Gmail Apps Script: ส่ง secret + ตาม redirect 302 แล้วอ่าน JSON', async () => {
  let received = null;
  const { server, url } = await startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/exec') {
      received = JSON.parse(await readBody(req));
      res.writeHead(302, { Location: '/echo?user_content_key=1' });
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/echo')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, remaining: 99 }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const r = await mailer.sendMail(message, { env: { GMAIL_SCRIPT_URL: `${url}/exec`, GMAIL_SCRIPT_SECRET: 'shh' } });
    assert.equal(r.provider, 'gmail-script');
    assert.equal(r.delivered, true);
    assert.equal(r.remainingQuota, 99);
    assert.equal(received.secret, 'shh');
    assert.equal(received.to, 'a@example.com');
    assert.ok(received.html.includes('ตั้งรหัสผ่านใหม่'));
  } finally {
    server.close();
  }
});

test('Gmail Apps Script: secret ผิด / ตอบเป็น HTML = error ที่อ่านเข้าใจ', async () => {
  const { server, url } = await startServer(async (req, res) => {
    await readBody(req);
    if (req.url === '/bad-secret') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>Sign in - Google Accounts</html>');
    }
  });
  try {
    await assert.rejects(mailer.sendMail(message, { env: { GMAIL_SCRIPT_URL: `${url}/bad-secret` } }), /unauthorized/);
    await assert.rejects(mailer.sendMail(message, { env: { GMAIL_SCRIPT_URL: `${url}/html` } }), /Who has access/);
  } finally {
    server.close();
  }
});
