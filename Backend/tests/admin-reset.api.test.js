// เทสต์ระบบ Admin + ลืมรหัสผ่าน/รีเซ็ตรหัสผ่านทางอีเมล แบบ end-to-end ผ่าน HTTP จริง
// ใช้ Supabase จำลองในหน่วยความจำ + ดักอีเมลไว้แทนการส่งจริง (รันได้ทันทีไม่ต้องตั้ง .env)
//   npm run test:offline
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_USERNAME = 'boss';
process.env.ADMIN_PASSWORD = 'super-secret-123';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.APP_URL = 'https://cine.example.com/';
delete process.env.TMDB_API_KEY;

const { createFake } = require('./helpers/fake-supabase');
const fake = createFake();
const supabasePath = require.resolve('../supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fake.client };

const mailer = require('../mailer');
const tmdb = require('../tmdb');
const { createServer, _limiters } = require('../server');
const { _loginLimiter } = require('../admin-routes');

const sentMail = [];
mailer.setTransportForTests(async (msg) => {
  sentMail.push(msg);
  return { provider: 'test', delivered: true };
});

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let server;
let base;

test.before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  _loginLimiter.clear();
  Object.values(_limiters).forEach((l) => l.clear());
});

async function call(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, body: json };
}

async function adminToken() {
  const r = await call('POST', '/api/admin/login', { body: { username: 'boss', password: 'super-secret-123' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

async function waitForMail(predicate, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = sentMail.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

function tokenFromMail(mail) {
  const m = /reset-password\.html\?token=([A-Za-z0-9_-]+)/.exec(mail.text);
  return m && m[1];
}

// ---------------------------------------------------------------------------
// Admin: เข้าสู่ระบบ
// ---------------------------------------------------------------------------
test('admin login: รหัสผิด = 401, ผิดเกิน 5 ครั้ง = 429, ถูก = ได้ token', async () => {
  const wrong = await call('POST', '/api/admin/login', { body: { username: 'boss', password: 'nope' } });
  assert.equal(wrong.status, 401);
  for (let i = 0; i < 4; i += 1) await call('POST', '/api/admin/login', { body: { username: 'boss', password: 'nope' } });
  const blocked = await call('POST', '/api/admin/login', { body: { username: 'boss', password: 'super-secret-123' } });
  assert.equal(blocked.status, 429);

  _loginLimiter.clear();
  const ok = await call('POST', '/api/admin/login', { body: { username: 'boss', password: 'super-secret-123' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  const me = await call('GET', '/api/admin/me', { token: ok.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.username, 'boss');
});

test('admin: ไม่มี token / token ปลอม / เปลี่ยน ADMIN_PASSWORD แล้ว token เก่าใช้ไม่ได้', async () => {
  assert.equal((await call('GET', '/api/admin/stats')).status, 401);
  assert.equal((await call('GET', '/api/admin/stats', { token: 'abc.def.ghi' })).status, 401);

  const token = await adminToken();
  assert.equal((await call('GET', '/api/admin/stats', { token })).status, 200);

  process.env.ADMIN_PASSWORD = 'another-password-456';
  assert.equal((await call('GET', '/api/admin/stats', { token })).status, 401);
  process.env.ADMIN_PASSWORD = 'super-secret-123';
  assert.equal((await call('GET', '/api/admin/stats', { token })).status, 200);
});

test('admin: ถ้ายังไม่ตั้ง ADMIN_PASSWORD หรือสั้นเกินไป = 503', async () => {
  const saved = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  const r1 = await call('POST', '/api/admin/login', { body: { username: 'boss', password: '' } });
  assert.equal(r1.status, 503);
  process.env.ADMIN_PASSWORD = 'short';
  const r2 = await call('POST', '/api/admin/login', { body: { username: 'boss', password: 'short' } });
  assert.equal(r2.status, 503);
  process.env.ADMIN_PASSWORD = saved;
});

// ---------------------------------------------------------------------------
// Admin: จัดการหนัง + รูปโปสเตอร์
// ---------------------------------------------------------------------------
test('admin movies: ค้นหา / กรองหนังที่ยังไม่มีรูป / แบ่งหน้า', async () => {
  const token = await adminToken();
  const all = await call('GET', '/api/admin/movies?limit=10', { token });
  assert.equal(all.status, 200);
  assert.equal(all.body.items.length, 10);
  assert.equal(all.body.total, fake.state.tables.movies.length);

  const firstTitle = fake.state.tables.movies[0].title;
  const found = await call('GET', `/api/admin/movies?search=${encodeURIComponent(firstTitle)}`, { token });
  assert.ok(found.body.items.some((m) => m.title === firstTitle));

  const byId = await call('GET', '/api/admin/movies?search=%233', { token });
  assert.deepEqual(byId.body.items.map((m) => m.id), [3]);

  fake.state.tables.movies[0].poster_url = 'https://img.example.com/a.jpg';
  const missing = await call('GET', '/api/admin/movies?poster=missing&limit=100', { token });
  assert.ok(!missing.body.items.some((m) => m.id === 1));
  const has = await call('GET', '/api/admin/movies?poster=has', { token });
  assert.deepEqual(has.body.items.map((m) => m.id), [1]);
  fake.state.tables.movies[0].poster_url = null;
});

test('admin movies: เพิ่ม / แก้ไข / ตรวจข้อมูลผิด / ลบ', async () => {
  const token = await adminToken();
  const created = await call('POST', '/api/admin/movies', {
    token,
    body: { title: 'หนังใหม่ของเรา', genre: 'Comedy', year: 2026, score: 8.44, tags: 'ฮา, เพื่อน, ฮา', posterClass: 'poster-comedy', icon: '😂' }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.score, 8.4);
  assert.deepEqual(created.body.tags, ['ฮา', 'เพื่อน']);
  const id = created.body.id;

  const updated = await call('PUT', `/api/admin/movies/${id}`, { token, body: { synopsis: 'เรื่องย่อใหม่', runtime: 120 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.synopsis, 'เรื่องย่อใหม่');
  assert.equal(updated.body.runtime, 120);
  assert.equal(updated.body.title, 'หนังใหม่ของเรา');

  assert.equal((await call('PUT', `/api/admin/movies/${id}`, { token, body: { year: 1700 } })).status, 400);
  assert.equal((await call('PUT', `/api/admin/movies/${id}`, { token, body: { score: 11 } })).status, 400);
  assert.equal((await call('PUT', `/api/admin/movies/${id}`, { token, body: { title: '' } })).status, 400);
  assert.equal((await call('PUT', `/api/admin/movies/${id}`, { token, body: { posterClass: 'evil' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/movies', { token, body: { genre: 'Drama' } })).status, 400);
  assert.equal((await call('PUT', '/api/admin/movies/999999', { token, body: { title: 'x' } })).status, 404);

  const del = await call('DELETE', `/api/admin/movies/${id}`, { token });
  assert.equal(del.status, 200);
  assert.equal((await call('GET', `/api/admin/movies/${id}`, { token })).status, 404);
});

test('admin poster: อัปโหลดไฟล์ / เปลี่ยนรูปแล้วลบไฟล์เก่า / ใช้ลิงก์ / ลบรูป / ไฟล์ปลอม', async () => {
  const token = await adminToken();
  const movieId = 5;

  const up = await call('POST', `/api/admin/movies/${movieId}/poster`, { token, body: { image: PNG_1PX } });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.match(up.body.movie.posterUrl, /\/storage\/v1\/object\/public\/posters\/movie-5-\d+\.png$/);
  assert.ok(fake.state.buckets.has('posters'), 'สร้าง bucket ให้อัตโนมัติ');
  assert.equal(fake.state.objects.size, 1);

  // หน้าเว็บสาธารณะเห็นรูปด้วย
  const publicMovie = await call('GET', `/api/movies/${movieId}`);
  assert.equal(publicMovie.body.posterUrl, up.body.movie.posterUrl);

  await new Promise((r) => setTimeout(r, 5));
  const up2 = await call('POST', `/api/admin/movies/${movieId}/poster`, { token, body: { image: PNG_1PX } });
  assert.equal(up2.status, 200);
  assert.notEqual(up2.body.movie.posterUrl, up.body.movie.posterUrl);
  assert.equal(fake.state.objects.size, 1, 'ไฟล์เก่าถูกลบออกจาก storage');

  const byUrl = await call('POST', `/api/admin/movies/${movieId}/poster`, { token, body: { url: 'https://image.tmdb.org/t/p/w500/abc.jpg' } });
  assert.equal(byUrl.status, 200);
  assert.equal(byUrl.body.movie.posterUrl, 'https://image.tmdb.org/t/p/w500/abc.jpg');
  assert.equal(fake.state.objects.size, 0);

  assert.equal((await call('POST', `/api/admin/movies/${movieId}/poster`, { token, body: { url: 'javascript:alert(1)' } })).status, 400);
  const fakeImage = `data:image/png;base64,${Buffer.from('<script>alert(1)</script> not an image').toString('base64')}`;
  assert.equal((await call('POST', `/api/admin/movies/${movieId}/poster`, { token, body: { image: fakeImage } })).status, 400);
  assert.equal((await call('POST', `/api/admin/movies/${movieId}/poster`, { token, body: {} })).status, 400);

  const removed = await call('DELETE', `/api/admin/movies/${movieId}/poster`, { token });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.posterUrl, null);
});

test('admin poster: ไฟล์ใหญ่เกินกำหนด = 413', async () => {
  const token = await adminToken();
  const big = `data:image/png;base64,${Buffer.alloc(9 * 1024 * 1024, 1).toString('base64')}`;
  const r = await call('POST', '/api/admin/movies/5/poster', { token, body: { image: big } });
  assert.equal(r.status, 413);
});

test('admin TMDB: ค้นหาโปสเตอร์ + เติมรูปอัตโนมัติ (จำลอง TMDB)', async () => {
  const token = await adminToken();
  assert.equal((await call('GET', '/api/admin/movies/1/tmdb', { token })).status, 503);

  process.env.TMDB_API_KEY = 'fake-v3-key';
  const calls = [];
  tmdb.setFetchForTests(async (url) => {
    calls.push(url);
    const q = new URL(url).searchParams.get('query');
    const results = q === 'ไม่มีเรื่องนี้' ? [] : [{ id: 42, title: q, release_date: '2020-01-01', poster_path: `/${encodeURIComponent(q).slice(0, 10)}.jpg` }];
    return { ok: true, status: 200, json: async () => ({ results }) };
  });

  const search = await call('GET', '/api/admin/movies/1/tmdb', { token });
  assert.equal(search.status, 200);
  assert.equal(search.body.items.length, 1);
  assert.match(search.body.items[0].posterUrl, /^https:\/\/image\.tmdb\.org\/t\/p\/w500\//);
  assert.match(calls[0], /api_key=fake-v3-key/);

  const auto = await call('POST', '/api/admin/posters/auto', { token, body: { limit: 3 } });
  assert.equal(auto.status, 200);
  assert.equal(auto.body.filled.length, 3);
  const withPoster = fake.state.tables.movies.filter((m) => m.poster_url);
  assert.equal(withPoster.length, 3);

  withPoster.forEach((m) => { m.poster_url = null; });
  delete process.env.TMDB_API_KEY;
});

// ---------------------------------------------------------------------------
// เมลแจ้งเตือนหลังเปลี่ยนรหัส / หลังรีเซ็ต (ระบบลืมรหัสผ่านหลักเทสต์อยู่ใน password-reset.test.js)
// ---------------------------------------------------------------------------
async function registerUser(username, email, password) {
  const r = await call('POST', '/api/register', { body: { username, email, password } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test('รีเซ็ตผ่านลิงก์ในเมล: ได้เมลยืนยัน "รหัสผ่านถูกเปลี่ยนแล้ว" พร้อมลิงก์ไม่ใช่ฉัน', async () => {
  sentMail.length = 0;
  await registerUser('nong_film', 'Film.Lover@Example.com', 'oldpass123');
  const r = await call('POST', '/api/forgot-password', { body: { email: 'film.lover@example.com' } });
  assert.equal(r.status, 200);
  const mail = await waitForMail((m) => /reset-password\.html\?token=/.test(m.text));
  assert.ok(mail, 'ต้องได้เมลลิงก์รีเซ็ต');
  assert.ok(mail.text.includes('https://cine.example.com/reset-password.html?token='), 'ใช้ APP_URL (ตัด / ท้ายออก)');
  const token = tokenFromMail(mail);
  const done = await call('POST', '/api/reset-password', { body: { token, newPassword: 'newpass456' } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const confirm = await waitForMail((m) => /ถูกเปลี่ยนแล้ว/.test(m.subject));
  assert.ok(confirm, 'ต้องได้เมลยืนยันการเปลี่ยนรหัส');
  assert.equal(confirm.to, 'Film.Lover@Example.com');
  assert.ok(confirm.text.includes('https://cine.example.com/login.html?forgot=1'));
});

test('admin ส่งลิงก์รีเซ็ต แต่ยังไม่ได้สร้างตาราง password_resets = บอกให้รัน migration', async () => {
  await registerUser('nomigrate', 'nomigrate@example.com', 'pass12345');
  const token = await adminToken();
  const user = fake.state.tables.users.find((u) => u.username === 'nomigrate');
  fake.state.missing = new Set(['password_resets']);
  const r = await call('POST', `/api/admin/users/${user.id}/send-reset`, { token });
  fake.state.missing = new Set();
  assert.equal(r.status, 500);
  assert.match(r.body.error, /migration_/);
});

test('เปลี่ยนรหัสจากหน้าโปรไฟล์: ได้เมลแจ้งเตือน + ต้องล็อกอินใหม่', async () => {
  sentMail.length = 0;
  await registerUser('changer', 'changer@example.com', 'first12345');
  const login = await call('POST', '/api/login', { body: { username: 'changer', password: 'first12345' } });
  const r = await call('POST', '/api/change-password', { token: login.body.token, body: { oldPassword: 'first12345', newPassword: 'second12345' } });
  assert.equal(r.status, 200);
  const mail = await waitForMail((m) => m.to === 'changer@example.com' && /ถูกเปลี่ยนแล้ว/.test(m.subject));
  assert.ok(mail);
  assert.ok(mail.text.includes('จากหน้าโปรไฟล์'));
  assert.equal((await call('GET', '/api/me', { token: login.body.token })).status, 401);
});

// ---------------------------------------------------------------------------
// Admin: ผู้ใช้ / รีวิว / ภาพรวม / สถานะระบบ
// ---------------------------------------------------------------------------
test('admin users: ค้นหา / ส่งลิงก์รีเซ็ต / บังคับออกจากระบบ / ลบ', async () => {
  const token = await adminToken();
  await registerUser('to_manage', 'manage@example.com', 'pass12345');
  const login = await call('POST', '/api/login', { body: { username: 'to_manage', password: 'pass12345' } });

  const list = await call('GET', '/api/admin/users?search=manage', { token });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  const user = list.body.items[0];
  assert.equal(user.reviewCount, 0);

  sentMail.length = 0;
  const reset = await call('POST', `/api/admin/users/${user.id}/send-reset`, { token });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.ok(sentMail.some((m) => m.to === 'manage@example.com'));

  const out = await call('POST', `/api/admin/users/${user.id}/logout`, { token });
  assert.equal(out.status, 200);
  assert.equal((await call('GET', '/api/me', { token: login.body.token })).status, 401);

  assert.equal((await call('DELETE', `/api/admin/users/${user.id}`, { token })).status, 200);
  assert.equal((await call('GET', '/api/admin/users?search=manage', { token })).body.items.length, 0);
  assert.equal((await call('DELETE', `/api/admin/users/${user.id}`, { token })).status, 404);
});

test('admin reviews + stats + status', async () => {
  const token = await adminToken();
  const posted = await call('POST', '/api/reviews', { body: { movieId: 2, author: 'guest', rating: 1, text: 'สแปมโฆษณา', spoiler: false } });
  assert.equal(posted.status, 201, JSON.stringify(posted.body));

  const list = await call('GET', '/api/admin/reviews?search=สแปม', { token });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].movieTitle, fake.state.tables.movies[1].title);

  const stats = await call('GET', '/api/admin/stats', { token });
  assert.equal(stats.status, 200);
  assert.equal(stats.body.movies, fake.state.tables.movies.length);
  assert.ok(stats.body.reviews >= 1);
  assert.equal(stats.body.moviesWithoutPoster, stats.body.movies - stats.body.moviesWithPoster);

  assert.equal((await call('DELETE', `/api/admin/reviews/${posted.body.id}`, { token })).status, 200);
  assert.equal((await call('DELETE', `/api/admin/reviews/${posted.body.id}`, { token })).status, 404);

  const status = await call('GET', '/api/admin/status', { token });
  assert.equal(status.status, 200);
  assert.equal(status.body.admin.ready, true);
  assert.equal(status.body.appUrl, 'https://cine.example.com');
  assert.equal(status.body.database.posterColumn, true);
  assert.equal(status.body.database.passwordResetsTable, true);
  assert.equal(status.body.storage.ok, true);

  sentMail.length = 0;
  const testMail = await call('POST', '/api/admin/test-email', { token, body: { to: 'me@example.com' } });
  assert.equal(testMail.status, 200);
  assert.equal(sentMail[0].to, 'me@example.com');
});
