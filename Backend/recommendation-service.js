'use strict';

const supabase = require('./supabase');
const { mapMovieRow } = require('./movies');
const db = require('./database');
const recommender = require('./recommender');

// ดึงเฉพาะคอลัมน์ที่ต้องใช้ (ไม่เอา synopsis/writer/budget ที่ยาวและไม่จำเป็น) ให้ query เบา
// และเลี่ยงเพดาน 1,000 แถวต่อ request ของ Supabase ด้วยการดึงเป็นก้อนเล็กๆ ตามแนว/ผู้กำกับ/นักแสดง
// แทนการโหลดหนังทั้ง 4,000 เรื่องมาคำนวณ
const LIST_COLUMNS = 'id,title,mpaa_rating,genre,year,score,votes,director,star,runtime,tags,poster_class,icon';

function toApiMovie(row) {
  return mapMovieRow(row);
}

async function fetchMoviesByIds(ids) {
  const unique = [...new Set(ids.map(Number).filter(Number.isFinite))];
  const result = new Map();
  const CHUNK = 150;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase.from('movies').select(LIST_COLUMNS).in('id', chunk);
    if (error) throw { status: 500, message: error.message };
    for (const row of data || []) result.set(row.id, toApiMovie(row));
  }
  return result;
}

async function loadProfile(userId) {
  const [views, reviews, watchlist, dismissed] = await Promise.all([
    db.getViewHistory(userId),
    db.getReviews({ userId }),
    db.getWatchlistEntries(userId),
    db.getDismissals(userId)
  ]);

  const ids = [...views, ...reviews, ...watchlist, ...dismissed].map((x) => x.movieId);
  const moviesById = await fetchMoviesByIds(ids);

  return recommender.buildTasteProfile({
    views,
    reviews: reviews.map((r) => ({ movieId: r.movieId, rating: r.rating, createdAt: r.createdAt })),
    watchlist,
    dismissed,
    moviesById
  });
}

async function fetchCandidates(profile) {
  const queries = [];

  // ตัวเลือกจากแนวที่ชอบ (และแนวใกล้เคียง) แนวละ 60 เรื่องคะแนนสูงสุด
  for (const genre of recommender.candidateGenres(profile, 5)) {
    queries.push(
      supabase
        .from('movies')
        .select(LIST_COLUMNS)
        .eq('genre', genre)
        .order('score', { ascending: false, nullsFirst: false })
        .limit(60)
    );
  }

  const directors = recommender.candidateDirectors(profile, 8);
  if (directors.length) {
    queries.push(supabase.from('movies').select(LIST_COLUMNS).in('director', directors).limit(100));
  }

  const stars = recommender.candidateStars(profile, 8);
  if (stars.length) {
    queries.push(supabase.from('movies').select(LIST_COLUMNS).in('star', stars).limit(100));
  }

  // กองกลาง: หนังคุณภาพสูงที่คนดูเยอะ ใช้เป็นตัวเลือกสำรอง (ผู้ใช้ใหม่) และเป็นช่อง "ลองแนวใหม่"
  queries.push(
    supabase
      .from('movies')
      .select(LIST_COLUMNS)
      .gte('votes', 20000)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(80)
  );

  const results = await Promise.all(queries);
  const pool = new Map();
  for (const { data, error } of results) {
    if (error) throw { status: 500, message: error.message };
    for (const row of data || []) pool.set(row.id, toApiMovie(row));
  }
  return [...pool.values()];
}

/**
 * หนังแนะนำเฉพาะผู้ใช้คนนี้
 * personalized=false หมายถึงยังไม่มีพฤติกรรมให้เรียนรู้ (ผู้ใช้ใหม่) จึงโชว์หนังคะแนนสูงทั่วไปแทน
 */
async function getRecommendations(userId, { limit = 12 } = {}) {
  const profile = await loadProfile(userId);
  const candidates = await fetchCandidates(profile);
  const items = recommender.recommend({ candidates, profile, limit });
  const summary = recommender.summarizeProfile(profile, { topN: 3 });

  return {
    personalized: profile.signalCount > 0,
    signalCount: profile.signalCount,
    basedOn: {
      genres: summary.genres.map((g) => g.name),
      directors: summary.directors.map((d) => d.name)
    },
    items: items.map((i) => ({ ...i.movie, reason: i.reason, reasonType: i.reasonType }))
  };
}

/** สรุปรสนิยมสำหรับหน้า Profile */
async function getTasteSummary(userId) {
  const profile = await loadProfile(userId);
  const summary = recommender.summarizeProfile(profile, { topN: 5 });
  return {
    ...summary,
    counts: {
      reviews: profile.reviewedIds.size,
      watchlist: profile.watchlistIds.size,
      viewed: profile.viewedIds.size
    }
  };
}

/** หนังที่คล้ายกับหนังเรื่องหนึ่ง (หน้า detail) */
async function getSimilar(movieId, { limit = 4 } = {}) {
  const numId = Number(movieId);
  if (!Number.isFinite(numId)) throw { status: 400, message: 'รหัสภาพยนตร์ไม่ถูกต้อง' };

  const { data: baseRow, error: baseError } = await supabase
    .from('movies')
    .select(LIST_COLUMNS)
    .eq('id', numId)
    .maybeSingle();
  if (baseError) throw { status: 500, message: baseError.message };
  if (!baseRow) throw { status: 404, message: 'ไม่พบข้อมูลภาพยนตร์ที่ระบุ' };
  const base = toApiMovie(baseRow);

  const queries = [
    supabase.from('movies').select(LIST_COLUMNS).eq('genre', base.genre).order('score', { ascending: false, nullsFirst: false }).limit(80)
  ];
  const director = recommender.cleanName(base.director);
  if (director) queries.push(supabase.from('movies').select(LIST_COLUMNS).eq('director', director).limit(40));
  const star = recommender.cleanName(base.star);
  if (star) queries.push(supabase.from('movies').select(LIST_COLUMNS).eq('star', star).limit(40));
  const neighbors = recommender.GENRE_NEIGHBORS[base.genre] || [];
  if (neighbors.length) {
    queries.push(
      supabase.from('movies').select(LIST_COLUMNS).in('genre', neighbors).order('score', { ascending: false, nullsFirst: false }).limit(40)
    );
  }

  const results = await Promise.all(queries);
  const pool = new Map();
  for (const { data, error } of results) {
    if (error) throw { status: 500, message: error.message };
    for (const row of data || []) pool.set(row.id, toApiMovie(row));
  }

  const items = recommender.similarMovies({ base, candidates: [...pool.values()], limit });
  return items.map((i) => ({ ...i.movie, reason: i.reason }));
}

module.exports = { getRecommendations, getTasteSummary, getSimilar };
