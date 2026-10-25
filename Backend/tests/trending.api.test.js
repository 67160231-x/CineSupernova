// เทสต์ "กำลังมาแรง" (หน้าแรก) บน Supabase จำลอง
const test = require('node:test');
const assert = require('node:assert/strict');

const { createFake } = require('./helpers/fake-supabase');
const fake = createFake();
const supabasePath = require.resolve('../supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fake.client };

const trending = require('../trending');
const { createServer } = require('../server');

async function getTrending(query = '') {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/movies/trending${query}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const now = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

test('ยังไม่มีใครใช้เว็บ: ได้ 10 เรื่องคะแนนสูงสุด เรียงอันดับ 1-10 และไม่ต้องล็อกอิน', async () => {
  trending._clearCache();
  const r = await getTrending();
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 10);
  assert.deepEqual(r.body.map((m) => m.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(r.body.every((m) => m.reason === 'คะแนนสูง'));
  const scores = r.body.map((m) => m.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('หนังที่คนรีวิว / เก็บ Watchlist / เปิดดูเยอะ ขึ้นอันดับต้น และพฤติกรรมเก่ากว่า 30 วันไม่นับ', async () => {
  trending._clearCache();
  const t = fake.state.tables;
  const low = t.movies[3000].id; // หนังคะแนนไม่ได้สูง
  const mid = t.movies[2000].id;
  const old = t.movies[1500].id;
  t.reviews.push({ id: 1, movie_id: low, user_id: 1, author: 'a', rating: 5, text: '', spoiler: false, created_at: now() });
  t.watchlist_items.push({ user_id: 1, movie_id: low, added_at: now() }, { user_id: 2, movie_id: low, added_at: now() });
  t.movie_views.push({ id: 1, user_id: 1, movie_id: mid, viewed_at: now() }, { id: 2, user_id: 2, movie_id: mid, viewed_at: now() });
  for (let i = 0; i < 20; i += 1) t.movie_views.push({ id: 10 + i, user_id: 3, movie_id: old, viewed_at: daysAgo(45) });

  const r = await getTrending();
  assert.equal(r.body[0].id, low, 'รีวิว 5 ดาว + Watchlist 2 คน = 5+2+3+3 แต้ม');
  assert.match(r.body[0].reason, /Watchlist 2/);
  assert.equal(r.body[1].id, mid);
  assert.match(r.body[1].reason, /เปิดดู 2 ครั้ง/);
  assert.ok(!r.body.some((m) => m.id === old), 'การเปิดดูเมื่อ 45 วันก่อนไม่นับ');
  assert.equal(r.body.length, 10, 'ที่เหลือเติมด้วยหนังคะแนนสูง');
  assert.equal(new Set(r.body.map((m) => m.id)).size, 10, 'ไม่มีเรื่องซ้ำ');
});

test('ยังไม่ได้สร้างตาราง movie_views: หน้าแรกไม่พัง', async () => {
  trending._clearCache();
  fake.state.missing = new Set(['movie_views']);
  const r = await getTrending('?limit=5');
  fake.state.missing = new Set();
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 5);
});
