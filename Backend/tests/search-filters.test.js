// เทสต์ตรรกะกรองหน้าค้นหา (Frontend/CineSupernova-main/search-filters.js) ด้วยข้อมูลหนังจริง 50 เรื่องจาก sql/seed_movies.sql
const test = require('node:test');
const assert = require('node:assert/strict');
const SF = require('../../Frontend/CineSupernova-main/search-filters.js');
const movies = require('./fixtures/seed-movies.json');

test('ทุกปุ่ม Vibe ในหน้าค้นหาต้องมีหนังให้เจอ (บั๊กเดิม: ปุ่มไทย vs แท็กอังกฤษ → ได้ 0 เรื่อง)', () => {
  const vibes = Object.keys(SF.VIBES);
  assert.equal(vibes.length, 6);
  for (const v of vibes) {
    const found = SF.applyFilters(movies, { vibes: [v] });
    assert.ok(found.length >= 3, `Vibe "${v}" ได้แค่ ${found.length} เรื่อง`);
  }
});

test('Vibe ให้ผลที่เข้ากับความรู้สึกจริง', () => {
  const horror = SF.applyFilters(movies, { vibes: ['ปิดไฟดูคนเดียวเท่านั้น'] });
  assert.ok(horror.every((m) => ['Horror', 'Thriller'].includes(m.genre) || m.tags.some((t) => ['horror', 'supernatural', 'zombie', 'survival', 'monster'].includes(t))));
  const funny = SF.applyFilters(movies, { vibes: ['ฮาจนสำลักป๊อปคอร์น'] });
  assert.ok(funny.some((m) => m.genre === 'Comedy'));
  assert.ok(funny.every((m) => m.genre === 'Comedy' || m.tags.some((t) => ['comedy', 'parody', 'buddy'].includes(t))));
});

test('หลาย Vibe = หรือ / ข้ามกลุ่มตัวกรอง = และ', () => {
  const a = SF.applyFilters(movies, { vibes: ['ปิดไฟดูคนเดียวเท่านั้น'] }).length;
  const b = SF.applyFilters(movies, { vibes: ['ฮาจนสำลักป๊อปคอร์น'] }).length;
  const both = SF.applyFilters(movies, { vibes: ['ปิดไฟดูคนเดียวเท่านั้น', 'ฮาจนสำลักป๊อปคอร์น'] }).length;
  assert.ok(both >= Math.max(a, b) && both <= a + b);
  const narrowed = SF.applyFilters(movies, { vibes: ['ปิดไฟดูคนเดียวเท่านั้น'], genres: ['Horror'], yearFrom: 2026 });
  assert.ok(narrowed.every((m) => m.genre === 'Horror' && m.year === 2026));
});

test('แท็กภาษาไทยในข้อมูลจริง (ถ้าเพิ่มในอนาคต) ก็ยังตรง', () => {
  const custom = [{ title: 'X', genre: 'Drama', year: 2026, score: 7, tags: ['ตับพัง 3 วัน'] }, { title: 'Y', genre: 'Action', year: 2026, score: 7, tags: [] }];
  assert.deepEqual(SF.applyFilters(custom, { vibes: ['ตับพัง 3 วัน'] }).map((m) => m.title), ['X']);
});

test('ประเภทหนัง: สร้างตัวเลือกจากข้อมูลจริง + ชื่อไทยครบ (รัก ดราม่า อนิเมะ)', () => {
  const { genres, years } = SF.buildFacets(movies);
  assert.equal(genres.reduce((s, g) => s + g.count, 0), 50);
  const label = Object.fromEntries(genres.map((g) => [g.value, g.label]));
  assert.match(label.Romance, /รัก/);
  assert.match(label.Drama, /ดราม่า/);
  assert.match(label.Animation, /อนิเมะ/);
  assert.deepEqual(years, [2026, 2025]);
  assert.equal(SF.genreLabel('Unknown-Genre'), 'Unknown-Genre'); // ประเภทใหม่ที่ยังไม่มีคำแปล แสดงชื่อเดิม ไม่หายไป
  assert.deepEqual(SF.applyFilters(movies, { genres: ['animation'] }).length, genres.find((g) => g.value === 'Animation').count);
});

test('ช่วงปี / คะแนนขั้นต่ำ / สลับช่วงปีที่ขัดแย้งกัน', () => {
  assert.ok(SF.applyFilters(movies, { yearFrom: 2026 }).every((m) => m.year === 2026));
  assert.ok(SF.applyFilters(movies, { yearTo: 2025 }).every((m) => m.year === 2025));
  assert.equal(SF.applyFilters(movies, { yearFrom: 2026, yearTo: 2025 }).length, 50, 'ช่วงปีสลับกัน → ตีความเป็น 2025-2026');
  const high = SF.applyFilters(movies, { minScore: 8 });
  assert.ok(high.length > 0 && high.every((m) => m.score >= 8));
  assert.equal(SF.applyFilters(movies, { minScore: 99 }).length, 0);
  assert.equal(SF.applyFilters(movies, { minScore: '' }).length, 50);
});

test('คำค้น: ชื่อเรื่อง ผู้กำกับ นักแสดง เรื่องย่อ และคำหลายคำต้องตรงทุกคำ', () => {
  const dune = SF.applyFilters(movies, { q: 'dune' });
  assert.ok(dune.length >= 1 && dune.every((m) => /dune/i.test(`${m.title} ${m.synopsis} ${m.director} ${m.star} ${m.tags}`)));
  const byDirector = SF.applyFilters(movies, { q: movies[0].director });
  assert.ok(byDirector.some((m) => m.title === movies[0].title));
  assert.equal(SF.applyFilters(movies, { q: 'ไม่มีหนังเรื่องนี้แน่ๆ zzzz' }).length, 0);
  assert.ok(SF.applyFilters(movies, { q: '  ' }).length === 50);
  assert.ok(SF.applyFilters(movies, { q: 'รัก' }).length >= 1, 'ค้นด้วยคำไทยของประเภทได้ (รัก → โรแมนติก)');
});

test('เรียงลำดับ: คะแนน / ใหม่-เก่า / ชื่อ', () => {
  const s = SF.applyFilters(movies, { sort: 'score' }).map((m) => m.score);
  assert.deepEqual(s, [...s].sort((a, b) => b - a));
  const n = SF.applyFilters(movies, { sort: 'newest' }).map((m) => m.year);
  assert.deepEqual(n, [...n].sort((a, b) => b - a));
  const o = SF.applyFilters(movies, { sort: 'oldest' }).map((m) => m.year);
  assert.deepEqual(o, [...o].sort((a, b) => a - b));
  const t = SF.applyFilters(movies, { sort: 'title' }).map((m) => m.title);
  assert.deepEqual(t, [...t].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  const unknown = SF.applyFilters(movies, { sort: 'ไม่รู้จัก' }).map((m) => m.score);
  assert.deepEqual(unknown, s, 'sort ที่ไม่รู้จัก = เรียงตามคะแนน');
});

test('หนังที่ไม่มีคะแนน/ปี ไม่ทำให้พัง และไม่ถูกนับเมื่อกรองคะแนน/ปี', () => {
  const odd = [{ title: 'A', genre: 'Drama', year: null, score: null, tags: null }, { title: 'B', genre: 'Drama', year: 2025, score: 7, tags: [] }];
  assert.equal(SF.applyFilters(odd, {}).length, 2);
  assert.deepEqual(SF.applyFilters(odd, { minScore: 5 }).map((m) => m.title), ['B']);
  assert.deepEqual(SF.applyFilters(odd, { yearFrom: 2000 }).map((m) => m.title), ['B']);
  assert.deepEqual(SF.applyFilters(odd, { sort: 'score' }).map((m) => m.title), ['B', 'A']);
});

test('hasActiveFilters บอกว่ามีตัวกรองทำงานอยู่หรือไม่', () => {
  assert.equal(SF.hasActiveFilters({}), false);
  assert.equal(SF.hasActiveFilters({ q: '  ', vibes: new Set(), genres: [], yearFrom: '', minScore: '', sort: 'newest' }), false);
  assert.equal(SF.hasActiveFilters({ vibes: new Set(['ตับพัง 3 วัน']) }), true);
  assert.equal(SF.hasActiveFilters({ minScore: '7' }), true);
  assert.equal(SF.hasActiveFilters({ q: 'x' }), true);
});
