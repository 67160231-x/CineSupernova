// เทสต์ตัวคำนวณรสนิยม/แนะนำหนัง (logic ล้วนๆ ไม่ต้องต่อ Supabase)
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../recommender');

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const M = (id, genre, extra = {}) => ({
  id, title: `Movie ${id}`, genre, year: 1995, score: 7.5, votes: 100000, director: `Dir ${id}`, star: `Star ${id}`, ...extra
});
const byId = (list) => new Map(list.map((m) => [m.id, m]));

test('reviewWeight: ชอบ = บวก, ไม่ชอบ = ลบ, ไม่มีคะแนน = 0', () => {
  assert.equal(R.reviewWeight(5), 5);
  assert.equal(R.reviewWeight(3), 1);
  assert.equal(R.reviewWeight(1), -3);
  assert.equal(R.reviewWeight(0), 0);
});

test('qualityScore: หนังที่มีคนโหวตน้อยมากไม่ควรได้คะแนนคุณภาพสูงเกินจริง', () => {
  const popular = R.qualityScore({ score: 8.5, votes: 900000 });
  const obscure = R.qualityScore({ score: 9.0, votes: 60 });
  assert.ok(popular > obscure);
});

test('ผู้ใช้ใหม่ (ไม่มีพฤติกรรม): ได้หนังคุณภาพสูงหลากหลายแนว และไม่ personalized', () => {
  const movies = [];
  const genres = ['Comedy', 'Drama', 'Action', 'Horror'];
  for (let i = 1; i <= 40; i += 1) movies.push(M(i, genres[i % 4], { score: 6 + (i % 5) * 0.5 }));
  const profile = R.buildTasteProfile({ moviesById: byId(movies) });
  assert.equal(profile.signalCount, 0);
  const out = R.recommend({ candidates: movies, profile, limit: 8 });
  assert.equal(out.length, 8);
  assert.ok(new Set(out.map((o) => o.movie.genre)).size >= 3, 'ควรมีหลายแนว');
  assert.ok(out.every((o) => o.reasonType === 'popular'));
});

test('ดูแนวไหนบ่อย แนะนำแนวนั้นเป็นหลัก และไม่แนะนำเรื่องที่รีวิว/เก็บ/กดไม่สนใจแล้ว', () => {
  const horror = Array.from({ length: 12 }, (_, i) => M(100 + i, 'Horror'));
  const comedy = Array.from({ length: 12 }, (_, i) => M(200 + i, 'Comedy'));
  const all = [...horror, ...comedy];
  const profile = R.buildTasteProfile({
    views: horror.slice(0, 5).map((m) => ({ movieId: m.id, viewedAt: ago(1) })),
    reviews: [{ movieId: 105, rating: 5, createdAt: ago(2) }],
    watchlist: [{ movieId: 106, addedAt: ago(1) }],
    dismissed: [{ movieId: 107, createdAt: ago(1) }],
    moviesById: byId(all)
  });
  const out = R.recommend({ candidates: all, profile, limit: 6 });
  const ids = out.map((o) => o.movie.id);
  assert.ok(out.slice(0, 3).every((o) => o.movie.genre === 'Horror'));
  for (const hidden of [105, 106, 107]) assert.ok(!ids.includes(hidden), `ไม่ควรมี ${hidden}`);
  // เรื่องที่แค่เปิดดู (ยังไม่เก็บ/รีวิว) ต้องไม่มาเป็นอันดับต้นๆ
  assert.ok(!ids.slice(0, 3).some((id) => id >= 100 && id < 105));
});

test('รีวิวให้คะแนนต่ำ ทำให้แนวนั้นถูกลดอันดับ', () => {
  const comedy = Array.from({ length: 8 }, (_, i) => M(200 + i, 'Comedy'));
  const drama = Array.from({ length: 8 }, (_, i) => M(300 + i, 'Drama'));
  const all = [...comedy, ...drama];
  const profile = R.buildTasteProfile({
    reviews: [
      { movieId: 200, rating: 1, createdAt: ago(1) },
      { movieId: 300, rating: 5, createdAt: ago(1) }
    ],
    moviesById: byId(all)
  });
  const out = R.recommend({ candidates: all, profile, limit: 4 });
  assert.ok(out[0].movie.genre === 'Drama');
  assert.ok(profile.genreAffinity.Comedy < profile.genreAffinity.Drama);
});

test('ผู้กำกับที่ชอบ ได้เหตุผลแบบเจาะจง', () => {
  const liked = M(1, 'Drama', { title: 'The Shining', director: 'Stanley Kubrick' });
  const target = M(2, 'Drama', { title: 'Eyes Wide Shut', director: 'Stanley Kubrick' });
  const filler = Array.from({ length: 6 }, (_, i) => M(10 + i, 'Drama'));
  const profile = R.buildTasteProfile({
    reviews: [{ movieId: 1, rating: 5, createdAt: ago(1) }],
    moviesById: byId([liked, target, ...filler])
  });
  const out = R.recommend({ candidates: [target, ...filler], profile, limit: 3 });
  const hit = out.find((o) => o.movie.id === 2);
  assert.ok(hit);
  assert.equal(hit.reasonType, 'director');
  assert.match(hit.reason, /The Shining/);
});

test('พฤติกรรมเก่า มีน้ำหนักน้อยกว่าพฤติกรรมล่าสุด', () => {
  const a = M(1, 'Horror');
  const b = M(2, 'Comedy');
  const profile = R.buildTasteProfile({
    views: [
      { movieId: 1, viewedAt: ago(200) },
      { movieId: 2, viewedAt: ago(0) }
    ],
    moviesById: byId([a, b])
  });
  assert.ok(profile.genreAffinity.Comedy > profile.genreAffinity.Horror);
});

test('ชื่อผู้กำกับที่ไม่ใช่คน (เช่น "Directors") ไม่นับเป็นรสนิยม', () => {
  const m = M(1, 'Drama', { director: 'Directors' });
  const profile = R.buildTasteProfile({ reviews: [{ movieId: 1, rating: 5 }], moviesById: byId([m]) });
  assert.deepEqual(Object.keys(profile.directorAffinity), []);
});

test('ชอบแนวที่มีหนังน้อย (เช่น Sci-Fi) ยังได้ตัวเลือกจากแนวใกล้เคียง', () => {
  const scifi = [M(1, 'Sci-Fi'), M(2, 'Sci-Fi')];
  const action = Array.from({ length: 6 }, (_, i) => M(10 + i, 'Action'));
  const profile = R.buildTasteProfile({
    reviews: [{ movieId: 1, rating: 5, createdAt: ago(1) }],
    moviesById: byId([...scifi, ...action])
  });
  const out = R.recommend({ candidates: [scifi[1], ...action], profile, limit: 5 });
  assert.ok(out.length >= 5);
  assert.ok(out.some((o) => o.reasonType === 'genre-neighbor'));
});

test('similarMovies: ไม่คืนตัวเอง และผู้กำกับเดียวกันมาก่อน', () => {
  const base = M(1, 'Drama', { director: 'Stanley Kubrick', year: 1980 });
  const sameDir = M(2, 'Crime', { director: 'Stanley Kubrick', year: 1999 });
  const sameGenre = M(3, 'Drama', { year: 1981 });
  const other = M(4, 'Comedy', { year: 2010 });
  const out = R.similarMovies({ base, candidates: [base, other, sameGenre, sameDir], limit: 3 });
  assert.ok(!out.some((o) => o.movie.id === 1));
  assert.equal(out[0].movie.id, 2);
  assert.match(out[0].reason, /ผู้กำกับเดียวกัน/);
});
