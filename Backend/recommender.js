'use strict';

/**
 * ระบบแนะนำหนังเฉพาะบุคคล (Personalized recommendations)
 *
 * ไฟล์นี้เป็น "logic ล้วนๆ" ไม่แตะฐานข้อมูล จึงเทสต์ได้โดยไม่ต้องต่อ Supabase
 * ส่วนที่ดึงข้อมูลจริงอยู่ใน recommendation-service.js
 *
 * แนวคิด: สร้าง "โปรไฟล์รสนิยม" ของผู้ใช้จากพฤติกรรม 4 แบบ
 *   - เปิดดูหนัง (view)        น้ำหนักเบา แต่ถ้าเปิดบ่อยก็สะสมได้
 *   - เพิ่มลง Watchlist        น้ำหนักปานกลาง
 *   - รีวิว + ให้คะแนน         น้ำหนักแรงสุด (คะแนนสูง = ชอบ, คะแนนต่ำ = ไม่ชอบ)
 *   - กด "ไม่สนใจ"             น้ำหนักลบ
 * แล้วนำโปรไฟล์ไปให้คะแนนหนังที่ยังไม่เคยดู ตาม แนว / ผู้กำกับ / นักแสดง / ยุค / คุณภาพ
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// พฤติกรรมเก่าๆ ค่อยๆ มีน้ำหนักน้อยลง (หน่วย: วัน) เพราะรสนิยมคนเปลี่ยนได้
const HALF_LIFE_DAYS = { view: 30, watchlist: 60, review: 120, dismissed: 90 };
const BASE_WEIGHT = { view: 1, watchlist: 3, dismissed: -1.5 };

// สัดส่วนที่ "แนวใกล้เคียง" ได้รับจากแนวที่ผู้ใช้ชอบ (เช่น ชอบ Sci-Fi -> Fantasy/Action ได้แต้มบางส่วน)
// จำเป็นเพราะข้อมูลจริงมีหนังบางแนวน้อยมาก (เช่น Sci-Fi มีแค่ 6 เรื่อง) ถ้าไม่มีตัวนี้จะแนะนำได้ไม่กี่เรื่อง
const NEIGHBOR_SHARE = 0.35;
const GENRE_NEIGHBORS = {
  'Sci-Fi': ['Fantasy', 'Action', 'Adventure', 'Thriller'],
  Fantasy: ['Adventure', 'Sci-Fi', 'Animation', 'Family'],
  Horror: ['Thriller', 'Mystery', 'Crime'],
  Thriller: ['Crime', 'Mystery', 'Horror', 'Action'],
  Mystery: ['Crime', 'Thriller', 'Drama'],
  Crime: ['Thriller', 'Drama', 'Mystery', 'Action'],
  Action: ['Adventure', 'Crime', 'Thriller', 'Sci-Fi'],
  Adventure: ['Action', 'Fantasy', 'Family', 'Animation'],
  Animation: ['Family', 'Adventure', 'Comedy', 'Fantasy'],
  Family: ['Animation', 'Comedy', 'Adventure'],
  Comedy: ['Romance', 'Family', 'Animation'],
  Romance: ['Drama', 'Comedy', 'Music'],
  Drama: ['Biography', 'History', 'Romance', 'Crime'],
  Biography: ['Drama', 'History'],
  History: ['Drama', 'Biography', 'Western'],
  Music: ['Romance', 'Drama', 'Comedy'],
  Western: ['Action', 'Adventure', 'History']
};

// น้ำหนักของแต่ละปัจจัยตอนให้คะแนนหนัง (รวม = 1)
const SCORE_WEIGHTS = { genre: 0.5, director: 0.18, star: 0.07, era: 0.07, quality: 0.18 };

// ในข้อมูลมีค่าผู้กำกับที่ไม่ใช่ชื่อคนปนอยู่ (เช่น "Directors") ต้องไม่นับเป็นรสนิยม
const INVALID_NAMES = new Set(['', 'directors', 'director', 'unknown', 'n/a', 'null', 'undefined']);

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return INVALID_NAMES.has(v.toLowerCase()) ? null : v;
}

function decadeOf(year) {
  const y = Number(year);
  return Number.isFinite(y) && y > 1800 ? Math.floor(y / 10) * 10 : null;
}

function decay(dateLike, halfLifeDays, now) {
  if (!dateLike) return 1;
  const t = new Date(dateLike).getTime();
  if (!Number.isFinite(t)) return 1;
  const ageDays = Math.max(0, (now - t) / DAY_MS);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

// คะแนนรีวิว -> น้ำหนัก: 4-5 ดาว = ชอบ, 3 = กลางๆ, ต่ำกว่า 3 = ไม่ชอบ (ติดลบ)
function reviewWeight(rating) {
  const r = Number(rating);
  if (!Number.isFinite(r) || r <= 0) return 0;
  if (r >= 4) return r;
  if (r >= 3) return 1;
  return -(4 - r);
}

// คะแนนคุณภาพแบบถ่วงด้วยจำนวนโหวต (Bayesian average) กันหนังที่มีคนโหวตแค่หลักสิบแต่ได้ 9.0
function qualityScore(movie) {
  const R = Number(movie.score);
  if (!Number.isFinite(R)) return 0;
  const v = Math.max(0, Number(movie.votes) || 0);
  const m = 10000;
  const C = 6.4;
  const weighted = (v / (v + m)) * R + (m / (v + m)) * C;
  return clamp((weighted - 5) / (8.5 - 5), 0, 1);
}

function bump(map, key, weight, title) {
  if (key === null || key === undefined) return;
  let e = map[key];
  if (!e) e = map[key] = { pos: 0, neg: 0, count: 0, topWeight: 0, topTitle: null };
  if (weight > 0) {
    e.pos += weight;
    if (weight > e.topWeight) {
      e.topWeight = weight;
      e.topTitle = title || null;
    }
  } else {
    e.neg += -weight;
  }
  e.count += 1;
}

/**
 * สร้างโปรไฟล์รสนิยมจากพฤติกรรมของผู้ใช้
 * @param {object} p
 * @param {Array<{movieId:number, viewedAt?:string}>} p.views
 * @param {Array<{movieId:number, rating:number, createdAt?:string}>} p.reviews
 * @param {Array<{movieId:number, addedAt?:string}>} p.watchlist
 * @param {Array<{movieId:number, createdAt?:string}>} p.dismissed
 * @param {Map<number,object>|object} p.moviesById  ข้อมูลหนังที่ผู้ใช้เคยมีปฏิสัมพันธ์ด้วย
 */
function buildTasteProfile({ views = [], reviews = [], watchlist = [], dismissed = [], moviesById = {}, now = Date.now() } = {}) {
  const lookup = (id) => (moviesById instanceof Map ? moviesById.get(Number(id)) : moviesById[Number(id)]);

  const stats = { genre: {}, director: {}, star: {}, decade: {} };
  const reviewedIds = new Set();
  const watchlistIds = new Set();
  const dismissedIds = new Set();
  const viewedIds = new Set();
  let signalCount = 0;

  function addSignal(movieId, weight) {
    const movie = lookup(movieId);
    if (!movie || !weight) return;
    signalCount += 1;
    bump(stats.genre, movie.genre || null, weight, movie.title);
    bump(stats.director, cleanName(movie.director), weight, movie.title);
    bump(stats.star, cleanName(movie.star), weight, movie.title);
    const decade = decadeOf(movie.year);
    bump(stats.decade, decade === null ? null : String(decade), weight, movie.title);
  }

  for (const v of views) {
    viewedIds.add(Number(v.movieId));
    addSignal(v.movieId, BASE_WEIGHT.view * decay(v.viewedAt, HALF_LIFE_DAYS.view, now));
  }
  for (const w of watchlist) {
    watchlistIds.add(Number(w.movieId));
    addSignal(w.movieId, BASE_WEIGHT.watchlist * decay(w.addedAt, HALF_LIFE_DAYS.watchlist, now));
  }
  for (const r of reviews) {
    reviewedIds.add(Number(r.movieId));
    addSignal(r.movieId, reviewWeight(r.rating) * decay(r.createdAt, HALF_LIFE_DAYS.review, now));
  }
  for (const d of dismissed) {
    dismissedIds.add(Number(d.movieId));
    addSignal(d.movieId, BASE_WEIGHT.dismissed * decay(d.createdAt, HALF_LIFE_DAYS.dismissed, now));
  }

  const totalPos = Object.values(stats.genre).reduce((sum, e) => sum + e.pos, 0);
  const denom = totalPos || 1;

  // แนว: สัดส่วนของ "แต้มบวกสุทธิ" เทียบกับแต้มบวกทั้งหมด (-1..1) + โบนัสจากแนวใกล้เคียง
  const genreAffinity = {};
  const genreNeighborSource = {};
  for (const [g, e] of Object.entries(stats.genre)) {
    genreAffinity[g] = clamp((e.pos - e.neg) / denom, -1, 1);
  }
  for (const [g, e] of Object.entries(stats.genre)) {
    if (e.pos <= 0) continue;
    for (const n of GENRE_NEIGHBORS[g] || []) {
      const bonus = (NEIGHBOR_SHARE * e.pos) / denom;
      const prev = genreAffinity[n] || 0;
      genreAffinity[n] = clamp(prev + bonus, -1, 1);
      const best = genreNeighborSource[n];
      if (!best || e.pos > best.pos) genreNeighborSource[n] = { genre: g, pos: e.pos };
    }
  }

  // ผู้กำกับ / นักแสดง: ใช้ tanh ให้อิ่มตัว (ดู 1 ครั้งไม่ควรฟันธงว่าชอบ แต่รีวิว 5 ดาวควรชัดเจน)
  const personAffinity = (map) => {
    const out = {};
    for (const [k, e] of Object.entries(map)) out[k] = Math.tanh((e.pos - e.neg) / 3);
    return out;
  };
  const decadeAffinity = {};
  for (const [k, e] of Object.entries(stats.decade)) decadeAffinity[k] = clamp((e.pos - e.neg) / denom, -1, 1);

  return {
    signalCount,
    totalWeight: totalPos,
    // ยิ่งมีข้อมูลพฤติกรรมมาก ยิ่งเชื่อโปรไฟล์ได้มาก (ข้อมูลน้อยๆ จะถูกลดน้ำหนักลง)
    confidence: Math.sqrt(clamp(totalPos / 5, 0, 1)),
    stats,
    genreAffinity,
    genreNeighborSource,
    directorAffinity: personAffinity(stats.director),
    starAffinity: personAffinity(stats.star),
    decadeAffinity,
    reviewedIds,
    watchlistIds,
    dismissedIds,
    viewedIds
  };
}

function topKeys(map, n, minValue = 0.05) {
  return Object.entries(map)
    .filter(([, v]) => v > minValue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

/** แนวที่ควรไปดึงมาเป็นตัวเลือก (แนวที่ชอบ + แนวใกล้เคียง) */
function candidateGenres(profile, n = 5) {
  return topKeys(profile.genreAffinity, n, 0.02);
}

function candidateDirectors(profile, n = 8) {
  return topKeys(profile.directorAffinity, n, 0.2);
}

function candidateStars(profile, n = 8) {
  return topKeys(profile.starAffinity, n, 0.2);
}

/** สรุปโปรไฟล์เป็น JSON สำหรับโชว์หน้า Profile */
function summarizeProfile(profile, { topN = 5 } = {}) {
  const totalPos = profile.totalWeight || 0;
  const genres = Object.entries(profile.stats.genre)
    .filter(([, e]) => e.pos > 0)
    .sort((a, b) => b[1].pos - a[1].pos)
    .slice(0, topN)
    .map(([name, e]) => ({ name, share: totalPos ? Math.round((e.pos / totalPos) * 100) : 0, count: e.count }));

  const people = (statMap, affMap) =>
    Object.entries(affMap)
      .filter(([, v]) => v >= 0.3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([name]) => ({ name, count: statMap[name].count, because: statMap[name].topTitle }));

  let favoriteDecade = null;
  const decades = Object.entries(profile.decadeAffinity).sort((a, b) => b[1] - a[1]);
  if (decades.length && decades[0][1] >= 0.4) favoriteDecade = Number(decades[0][0]);

  return {
    signalCount: profile.signalCount,
    genres,
    directors: people(profile.stats.director, profile.directorAffinity),
    stars: people(profile.stats.star, profile.starAffinity),
    favoriteDecade
  };
}

function reasonFor(movie, profile, parts) {
  // เหตุผลที่ "เจาะจง" (ผู้กำกับ/นักแสดง) น่าสนใจกว่าเหตุผลกว้างๆ อย่างแนวหนัง
  // เลยให้ความสำคัญก่อน ถ้าสัญญาณแรงพอ ส่วนที่เหลือเลือกปัจจัยที่ส่งผลมากที่สุด
  let type;
  let value;
  if (parts.director >= 0.5) {
    type = 'director';
    value = parts.director * SCORE_WEIGHTS.director;
  } else if (parts.star >= 0.6) {
    type = 'star';
    value = parts.star * SCORE_WEIGHTS.star;
  } else {
    const genreEra = [
      ['genre', parts.genre * SCORE_WEIGHTS.genre],
      ['era', parts.era * SCORE_WEIGHTS.era]
    ].sort((a, b) => b[1] - a[1]);
    [type, value] = genreEra[0];
  }

  if ((type === 'genre' || type === 'era') && value < 0.06) {
    return { reasonType: 'popular', reason: 'คะแนนสูง คนดูเยอะ' };
  }

  if (type === 'director') {
    const e = profile.stats.director[cleanName(movie.director)];
    const reason = e && e.topTitle && e.topTitle !== movie.title
      ? `ผู้กำกับเดียวกับ "${e.topTitle}" ที่คุณสนใจ`
      : `ผลงานของ ${movie.director} ผู้กำกับที่คุณสนใจ`;
    return { reasonType: 'director', reason };
  }
  if (type === 'star') {
    return { reasonType: 'star', reason: `นำแสดงโดย ${movie.star} ที่คุณน่าจะชอบ` };
  }
  if (type === 'era') {
    return { reasonType: 'era', reason: `หนังยุค ${decadeOf(movie.year)}s แบบที่คุณดูบ่อย` };
  }
  const direct = profile.stats.genre[movie.genre];
  if (direct && direct.pos > 0) {
    return { reasonType: 'genre', reason: `เพราะคุณชอบหนังแนว ${movie.genre}` };
  }
  const src = profile.genreNeighborSource[movie.genre];
  return {
    reasonType: 'genre-neighbor',
    reason: src ? `คล้ายแนว ${src.genre} ที่คุณชอบ` : `ใกล้เคียงแนวที่คุณชอบ`
  };
}

function scoreMovie(movie, profile) {
  const conf = profile.confidence;
  const dir = cleanName(movie.director);
  const star = cleanName(movie.star);
  const decade = decadeOf(movie.year);

  const parts = {
    genre: (profile.genreAffinity[movie.genre] || 0) * conf,
    director: dir ? profile.directorAffinity[dir] || 0 : 0,
    star: star ? profile.starAffinity[star] || 0 : 0,
    era: decade === null ? 0 : (profile.decadeAffinity[String(decade)] || 0) * conf,
    quality: qualityScore(movie)
  };

  let score =
    parts.genre * SCORE_WEIGHTS.genre +
    parts.director * SCORE_WEIGHTS.director +
    parts.star * SCORE_WEIGHTS.star +
    parts.era * SCORE_WEIGHTS.era +
    parts.quality * SCORE_WEIGHTS.quality;

  // เคยเปิดดูหน้านั้นแล้ว (แต่ยังไม่รีวิว/ไม่เก็บ) ไม่ควรมาโผล่เป็น "หนังใหม่ที่แนะนำ" อีก
  // เลยหักคะแนนแรงๆ ให้ไปอยู่ท้ายแถว (ไม่ตัดทิ้งเด็ดขาด เผื่อมีตัวเลือกน้อย)
  if (profile.viewedIds.has(Number(movie.id))) score -= 0.3;

  return { score, parts };
}

/**
 * จัดอันดับหนังแนะนำ
 * @param {object} p
 * @param {Array<object>} p.candidates  หนังตัวเลือก (ไม่ต้องกรองซ้ำ ฟังก์ชันนี้กรองให้)
 * @param {object} p.profile            จาก buildTasteProfile
 * @param {number} p.limit
 */
function recommend({ candidates, profile, limit = 12 }) {
  const excluded = new Set([...profile.reviewedIds, ...profile.watchlistIds, ...profile.dismissedIds]);
  const seen = new Set();
  const scored = [];

  for (const movie of candidates) {
    const id = Number(movie.id);
    if (excluded.has(id) || seen.has(id)) continue;
    seen.add(id);
    const { score, parts } = scoreMovie(movie, profile);
    scored.push({ movie, score, parts });
  }
  scored.sort((a, b) => b.score - a.score);

  // เลือกทีละเรื่องแบบมีความหลากหลาย: ถ้าแนว/ผู้กำกับซ้ำกับที่เลือกไปแล้ว หักคะแนน
  // กันไม่ให้ทั้งหน้าเป็นหนังแนวเดียว/ผู้กำกับคนเดียว
  const picked = [];
  const genreCount = {};
  const dirCount = {};
  const pool = scored.slice();
  while (picked.length < limit && pool.length) {
    let bestIdx = 0;
    let bestAdj = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const m = pool[i].movie;
      const dir = cleanName(m.director);
      const adj = pool[i].score - 0.06 * (genreCount[m.genre] || 0) - 0.1 * (dir ? dirCount[dir] || 0 : 0);
      if (adj > bestAdj) {
        bestAdj = adj;
        bestIdx = i;
      }
    }
    const [item] = pool.splice(bestIdx, 1);
    picked.push(item);
    genreCount[item.movie.genre] = (genreCount[item.movie.genre] || 0) + 1;
    const dir = cleanName(item.movie.director);
    if (dir) dirCount[dir] = (dirCount[dir] || 0) + 1;
  }

  let items = picked.map(({ movie, score, parts }) => ({
    movie,
    score,
    ...(profile.signalCount > 0 ? reasonFor(movie, profile, parts) : { reasonType: 'popular', reason: 'คะแนนสูง คนดูเยอะ' })
  }));

  // เปิดช่องให้ "ลองแนวใหม่" 1 เรื่อง (เฉพาะคนที่มีรสนิยมชัดแล้ว) กันโดนจำกัดอยู่แต่แนวเดิม
  if (profile.signalCount >= 3 && items.length >= 6) {
    const pickedIds = new Set(items.map((i) => Number(i.movie.id)));
    const explore = pool
      .filter((c) => {
        const g = profile.stats.genre[c.movie.genre];
        return !pickedIds.has(Number(c.movie.id)) && !(g && g.pos > 0) && c.parts.quality >= 0.6;
      })
      .sort((a, b) => b.parts.quality - a.parts.quality)[0];
    if (explore) {
      items[items.length - 1] = { movie: explore.movie, score: explore.score, reasonType: 'explore', reason: 'ลองแนวใหม่ๆ ดูบ้าง' };
    }
  }

  return items;
}

/**
 * หนังที่คล้ายกับหนังเรื่องหนึ่ง (ใช้ในหน้า detail) — ไม่ต้องล็อกอิน ไม่ขึ้นกับโปรไฟล์ผู้ใช้
 */
function similarMovies({ base, candidates, limit = 4 }) {
  const baseDir = cleanName(base.director);
  const baseStar = cleanName(base.star);
  const neighbors = new Set(GENRE_NEIGHBORS[base.genre] || []);

  const scored = [];
  for (const c of candidates) {
    if (Number(c.id) === Number(base.id)) continue;
    const sameDir = baseDir && cleanName(c.director) === baseDir;
    const sameStar = baseStar && cleanName(c.star) === baseStar;
    const sameGenre = c.genre === base.genre;
    const nearGenre = !sameGenre && neighbors.has(c.genre);
    const yearGap = Math.min(30, Math.abs((Number(c.year) || 0) - (Number(base.year) || 0)));

    const score =
      (sameGenre ? 0.4 : 0) +
      (nearGenre ? 0.15 : 0) +
      (sameDir ? 0.35 : 0) +
      (sameStar ? 0.15 : 0) +
      (1 - yearGap / 30) * 0.1 +
      qualityScore(c) * 0.1;

    let reason = 'แนวใกล้เคียงกัน';
    if (sameDir) reason = `ผู้กำกับเดียวกัน (${base.director})`;
    else if (sameStar) reason = `นำแสดงโดย ${base.star} เหมือนกัน`;
    else if (sameGenre) reason = `แนว ${base.genre} เหมือนกัน`;

    scored.push({ movie: c, score, reason });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = {
  buildTasteProfile,
  recommend,
  similarMovies,
  summarizeProfile,
  candidateGenres,
  candidateDirectors,
  candidateStars,
  qualityScore,
  reviewWeight,
  decadeOf,
  cleanName,
  GENRE_NEIGHBORS
};
