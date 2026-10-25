'use strict';
// หนัง "กำลังมาแรง" สำหรับหน้าแรก
// คิดจากการใช้งานจริงบนเว็บในช่วง 30 วันล่าสุด:
//   รีวิว = 5 แต้ม (+2 ถ้าให้ 4 ดาวขึ้นไป) · เพิ่มลง Watchlist = 3 แต้ม · เปิดดูหน้าหนัง = 1 แต้ม
// ถ้ายังมีคนใช้เว็บน้อย (ได้ไม่ครบ 10 เรื่อง) จะเติมด้วยหนังคะแนนสูงสุดให้ครบเสมอ

const supabase = require('./supabase');
const { mapMovieRow } = require('./movies');

const WINDOW_DAYS = 30;
const CACHE_MS = 60 * 1000; // คำนวณใหม่อย่างมากนาทีละครั้ง หน้าแรกจะได้โหลดเร็วและไม่ยิงฐานข้อมูลถี่
const POINTS = { review: 5, likedReview: 2, watchlist: 3, view: 1 };

let cache = null;

function isMissingTable(error) {
  return Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || ''));
}

// อ่านตารางพฤติกรรม ถ้ายังไม่มีตาราง (ยังไม่รัน migration) ให้ถือว่าว่าง ไม่ทำให้หน้าแรกพัง
async function recentRows(table, columns, timeColumn, since) {
  const { data, error } = await supabase.from(table).select(columns).gte(timeColumn, since).limit(5000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw { status: 500, message: error.message };
  }
  return data || [];
}

async function computeTrending(limit) {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [views, watchlist, reviews] = await Promise.all([
    recentRows('movie_views', 'movie_id', 'viewed_at', since),
    recentRows('watchlist_items', 'movie_id', 'added_at', since),
    recentRows('reviews', 'movie_id, rating', 'created_at', since)
  ]);

  const stats = new Map();
  const bump = (id, key, points) => {
    if (!Number.isFinite(Number(id))) return;
    const s = stats.get(id) || { points: 0, views: 0, watchlist: 0, reviews: 0 };
    s.points += points;
    s[key] += 1;
    stats.set(id, s);
  };
  views.forEach((r) => bump(r.movie_id, 'views', POINTS.view));
  watchlist.forEach((r) => bump(r.movie_id, 'watchlist', POINTS.watchlist));
  reviews.forEach((r) => {
    bump(r.movie_id, 'reviews', POINTS.review);
    if (Number(r.rating) >= 4) stats.get(r.movie_id).points += POINTS.likedReview;
  });

  const rankedIds = [...stats.entries()]
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, limit)
    .map(([id]) => Number(id));

  const items = [];
  if (rankedIds.length) {
    const { data, error } = await supabase.from('movies').select('*').in('id', rankedIds);
    if (error) throw { status: 500, message: error.message };
    const byId = new Map((data || []).map((row) => [Number(row.id), row]));
    for (const id of rankedIds) {
      const row = byId.get(id);
      if (!row) continue;
      const s = stats.get(id);
      const parts = [];
      if (s.views) parts.push(`เปิดดู ${s.views} ครั้ง`);
      if (s.watchlist) parts.push(`Watchlist ${s.watchlist}`);
      if (s.reviews) parts.push(`รีวิว ${s.reviews}`);
      items.push({ ...mapMovieRow(row), trend: { points: s.points, ...s }, reason: parts.join(' · ') });
    }
  }

  // คนใช้ยังน้อย -> เติมด้วยหนังคะแนนสูงสุด (ให้หนังที่มีรูปโปสเตอร์ขึ้นก่อน หน้าแรกจะได้สวย)
  if (items.length < limit) {
    const { data, error } = await supabase
      .from('movies')
      .select('*')
      .order('score', { ascending: false, nullsFirst: false })
      .order('year', { ascending: false })
      .limit(60);
    if (error) throw { status: 500, message: error.message };
    const taken = new Set(items.map((m) => Number(m.id)));
    const pool = (data || []).filter((row) => !taken.has(Number(row.id)));
    pool.sort((a, b) => Number(Boolean(b.poster_url)) - Number(Boolean(a.poster_url)));
    for (const row of pool) {
      if (items.length >= limit) break;
      items.push({ ...mapMovieRow(row), trend: null, reason: 'คะแนนสูง' });
    }
  }

  return items.map((m, i) => ({ ...m, rank: i + 1 }));
}

async function getTrending({ limit = 10 } = {}) {
  const n = Math.min(20, Math.max(1, Number(limit) || 10));
  if (cache && cache.limit === n && Date.now() - cache.at < CACHE_MS) return cache.items;
  const items = await computeTrending(n);
  cache = { at: Date.now(), limit: n, items };
  return items;
}

module.exports = {
  getTrending,
  _clearCache() {
    cache = null;
  }
};
