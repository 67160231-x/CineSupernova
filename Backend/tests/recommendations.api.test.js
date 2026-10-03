// เทสต์ API ระบบแนะนำหนังแบบ end-to-end ผ่าน HTTP จริง แต่ใช้ Supabase จำลองในหน่วยความจำ
// (รันได้ทันทีโดยไม่ต้องตั้งค่า .env):  npm run test:offline
const test = require('node:test');
const assert = require('node:assert/strict');

const { createFake } = require('./helpers/fake-supabase');
const fake = createFake();

// ใส่ Supabase จำลองเข้า require cache ก่อนโหลดโมดูลอื่นของโปรเจกต์
const supabasePath = require.resolve('../supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fake.client };

const auth = require('../auth');
const { createServer } = require('../server');

// ข้ามขั้นตอน JWT: token = "u<ID>" แทนผู้ใช้หมายเลขนั้น
auth.verifyToken = async (token) => {
  const m = /^u(\d+)$/.exec(token);
  if (!m) throw { status: 401, message: 'Session หมดอายุหรือถูกยกเลิกแล้ว' };
  return { userId: Number(m[1]), jti: 'test' };
};

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn(call);
  } finally {
    await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

const movies = fake.state.tables.movies;
const horror = movies.filter((m) => m.genre === 'Horror').sort((a, b) => b.votes - a.votes);

test('ไม่ล็อกอิน = 401', async () => {
  await withServer(async (call) => {
    assert.equal((await call('GET', '/api/recommendations')).status, 401);
    assert.equal((await call('GET', '/api/taste-profile')).status, 401);
    assert.equal((await call('POST', '/api/views', { body: { movieId: 1 } })).status, 401);
    assert.equal((await call('POST', '/api/recommendations/dismiss', { body: { movieId: 1 } })).status, 401);
  });
});

test('ผู้ใช้ใหม่: ได้หนังคะแนนสูงหลายแนว (personalized = false)', async () => {
  await withServer(async (call) => {
    const r = await call('GET', '/api/recommendations?limit=8', { token: 'u1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.personalized, false);
    assert.equal(r.body.items.length, 8);
    assert.ok(new Set(r.body.items.map((m) => m.genre)).size >= 4);
    assert.ok(r.body.items.every((m) => m.reason && m.title));
  });
});

test('เปิดดูหนังสยองขวัญหลายเรื่อง -> แนะนำสยองขวัญเป็นหลัก ไม่ซ้ำเรื่องที่เพิ่งเปิดดู', async () => {
  await withServer(async (call) => {
    const viewed = horror.slice(0, 6).map((m) => m.id);
    for (const id of viewed) {
      assert.equal((await call('POST', '/api/views', { token: 'u2', body: { movieId: id } })).status, 201);
    }
    const r = await call('GET', '/api/recommendations?limit=8', { token: 'u2' });
    assert.equal(r.body.personalized, true);
    assert.equal(r.body.basedOn.genres[0], 'Horror');
    const top = r.body.items.slice(0, 4);
    assert.ok(top.every((m) => m.genre === 'Horror'), 'อันดับต้นควรเป็น Horror');
    assert.ok(top.every((m) => !viewed.includes(m.id)));
    assert.ok(top.every((m) => /Horror/.test(m.reason) || m.reasonType !== 'popular'));
  });
});

test('Watchlist + รีวิว มีผลต่อรสนิยม และเรื่องที่เก็บ/รีวิวแล้วไม่ถูกแนะนำซ้ำ', async () => {
  const comedy = movies.filter((m) => m.genre === 'Comedy').sort((a, b) => b.votes - a.votes);
  fake.state.tables.watchlist_items.push({ user_id: 3, movie_id: comedy[0].id, added_at: new Date().toISOString() });
  fake.state.tables.reviews.push({ id: 1, movie_id: comedy[1].id, user_id: 3, author: 'x', rating: 5, text: '', spoiler: false, created_at: new Date().toISOString() });
  await withServer(async (call) => {
    const r = await call('GET', '/api/recommendations?limit=12', { token: 'u3' });
    assert.equal(r.body.personalized, true);
    const ids = r.body.items.map((m) => m.id);
    assert.ok(!ids.includes(comedy[0].id) && !ids.includes(comedy[1].id));
    assert.equal(r.body.basedOn.genres[0], 'Comedy');
  });
});

test('กด "ไม่สนใจ" แล้วเรื่องนั้นไม่กลับมาอีก / เรื่องที่ไม่มีอยู่จริง = 404', async () => {
  await withServer(async (call) => {
    const before = await call('GET', '/api/recommendations?limit=8', { token: 'u4' });
    const target = before.body.items[0];
    assert.equal((await call('POST', '/api/recommendations/dismiss', { token: 'u4', body: { movieId: target.id } })).status, 201);
    const after = await call('GET', '/api/recommendations?limit=8', { token: 'u4' });
    assert.ok(!after.body.items.some((m) => m.id === target.id));
    assert.equal((await call('POST', '/api/recommendations/dismiss', { token: 'u4', body: { movieId: 99999999 } })).status, 404);
    assert.equal((await call('POST', '/api/views', { token: 'u4', body: { movieId: 99999999 } })).status, 404);
    assert.equal((await call('POST', '/api/views', { token: 'u4', body: { movieId: 'abc' } })).status, 400);
  });
});

test('taste-profile: สรุปแนวที่ชอบ + จำนวนพฤติกรรม', async () => {
  await withServer(async (call) => {
    const r = await call('GET', '/api/taste-profile', { token: 'u2' });
    assert.equal(r.status, 200);
    assert.equal(r.body.genres[0].name, 'Horror');
    assert.equal(r.body.genres[0].share, 100);
    assert.equal(r.body.counts.viewed, 6);
    const empty = await call('GET', '/api/taste-profile', { token: 'u99' });
    assert.deepEqual(empty.body.genres, []);
  });
});

test('หนังที่คล้ายกัน: ไม่ต้องล็อกอิน ไม่คืนตัวเอง และเจอผู้กำกับเดียวกันก่อน', async () => {
  await withServer(async (call) => {
    const shining = movies.find((m) => m.title === 'The Shining');
    const r = await call('GET', `/api/movies/${shining.id}/similar?limit=4`);
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 4);
    assert.ok(!r.body.some((m) => m.id === shining.id));
    assert.match(r.body[0].reason, /ผู้กำกับเดียวกัน/);
    assert.equal((await call('GET', '/api/movies/99999999/similar')).status, 404);
    assert.equal((await call('GET', '/api/movies/abc/similar')).status, 400);
  });
});

test('ยังไม่ได้รัน migration: ระบบไม่พัง แนะนำจากรีวิว/Watchlist ได้ และ dismiss แจ้ง 503', async () => {
  fake.state.missing = new Set(['movie_views', 'movie_dismissals']);
  const drama = movies.filter((m) => m.genre === 'Drama').sort((a, b) => b.votes - a.votes);
  fake.state.tables.reviews.push({ id: 2, movie_id: drama[0].id, user_id: 7, author: 'x', rating: 5, text: '', spoiler: false, created_at: new Date().toISOString() });
  try {
    await withServer(async (call) => {
      assert.equal((await call('POST', '/api/views', { token: 'u7', body: { movieId: 1 } })).status, 201);
      const r = await call('GET', '/api/recommendations?limit=6', { token: 'u7' });
      assert.equal(r.status, 200);
      assert.equal(r.body.personalized, true);
      assert.equal(r.body.basedOn.genres[0], 'Drama');
      assert.equal((await call('POST', '/api/recommendations/dismiss', { token: 'u7', body: { movieId: 1 } })).status, 503);
    });
  } finally {
    fake.state.missing = new Set();
  }
});
