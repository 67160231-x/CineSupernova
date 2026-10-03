const supabase = require('./supabase');
const { mapMovieRow } = require('./movies');

// เก็บไว้เพื่อความเข้ากันได้กับ server.js เดิม (ไม่มีอะไรต้อง init แล้ว
// เพราะ schema ถูกสร้างผ่าน sql/schema.sql ใน Supabase Dashboard โดยตรง)
async function initDb() {
  return true;
}

function mapReviewRow(row) {
  return {
    id: row.id,
    movieId: row.movie_id,
    userId: row.user_id,
    author: row.author,
    rating: Number(row.rating),
    text: row.text,
    spoiler: Boolean(row.spoiler),
    createdAt: row.created_at
  };
}

async function addReview({ movieId, userId, author, rating, text, spoiler }) {
  const numMovieId = Number(movieId);
  if (!Number.isFinite(numMovieId)) {
    throw { status: 400, message: 'ต้องระบุหนังที่ต้องการรีวิว (movieId ไม่ถูกต้อง)' };
  }
  const { data, error } = await supabase
    .from('reviews')
    .insert({
      movie_id: numMovieId,
      user_id: userId || null,
      author,
      rating,
      text,
      spoiler: Boolean(spoiler)
    })
    .select('*')
    .single();
  if (error) throw { status: 400, message: error.message };
  return mapReviewRow(data);
}

async function getReviews({ movieId, userId } = {}) {
  let query = supabase.from('reviews').select('*').order('created_at', { ascending: false });
  if (movieId !== undefined && movieId !== null) query = query.eq('movie_id', Number(movieId));
  if (userId !== undefined && userId !== null) query = query.eq('user_id', Number(userId));
  const { data, error } = await query;
  if (error) throw { status: 500, message: error.message };
  return (data || []).map(mapReviewRow);
}

async function getWatchlist(userId) {
  const { data, error } = await supabase
    .from('watchlist_items')
    .select('added_at, movies(*)')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });
  if (error) throw { status: 500, message: error.message };
  return (data || [])
    .filter((row) => row.movies)
    .map((row) => ({ ...mapMovieRow(row.movies), addedAt: row.added_at }));
}

async function addToWatchlist(userId, movieId) {
  const numMovieId = Number(movieId);
  if (!Number.isFinite(numMovieId)) throw { status: 400, message: 'movieId ไม่ถูกต้อง' };
  const { error } = await supabase
    .from('watchlist_items')
    .upsert({ user_id: userId, movie_id: numMovieId }, { onConflict: 'user_id,movie_id' });
  if (error) throw { status: 500, message: error.message };
  return true;
}

async function removeFromWatchlist(userId, movieId) {
  const numMovieId = Number(movieId);
  if (!Number.isFinite(numMovieId)) throw { status: 400, message: 'movieId ไม่ถูกต้อง' };
  const { error } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('user_id', userId)
    .eq('movie_id', numMovieId);
  if (error) throw { status: 500, message: error.message };
  return true;
}

// ---------------------------------------------------------------------------
// ข้อมูลพฤติกรรมสำหรับระบบแนะนำหนัง (movie_views / movie_dismissals)
// ถ้ายังไม่ได้รัน sql/migration_recommendations.sql ตารางสองตัวนี้จะยังไม่มี
// ระบบจะไม่พัง แต่จะแนะนำจากรีวิว + Watchlist อย่างเดียวไปก่อน (และเตือนใน console ครั้งเดียว)
// ---------------------------------------------------------------------------
let warnedMissingTables = false;

function isMissingTable(error) {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /does not exist|schema cache/i.test(error.message || '')
  );
}

function handleOptionalTableError(error, fallback) {
  if (isMissingTable(error)) {
    if (!warnedMissingTables) {
      warnedMissingTables = true;
      console.warn('⚠️ ยังไม่มีตาราง movie_views / movie_dismissals — รัน Backend/sql/migration_recommendations.sql ใน Supabase เพื่อเปิดใช้เต็มรูปแบบ');
    }
    return fallback;
  }
  throw { status: 500, message: error.message };
}

async function recordView(userId, movieId) {
  const numMovieId = Number(movieId);
  if (!Number.isFinite(numMovieId)) throw { status: 400, message: 'movieId ไม่ถูกต้อง' };
  const { error } = await supabase.from('movie_views').insert({ user_id: userId, movie_id: numMovieId });
  if (error) {
    if (error.code === '23503') throw { status: 404, message: 'ไม่พบภาพยนตร์ที่ระบุ' };
    return handleOptionalTableError(error, false);
  }
  return true;
}

// ประวัติการเปิดดูล่าสุดของผู้ใช้ (จำกัดจำนวน เพื่อไม่ให้ query หนักเมื่อผู้ใช้เปิดดูเยอะ)
async function getViewHistory(userId, limit = 300) {
  const { data, error } = await supabase
    .from('movie_views')
    .select('movie_id, viewed_at')
    .eq('user_id', userId)
    .order('viewed_at', { ascending: false })
    .limit(limit);
  if (error) return handleOptionalTableError(error, []);
  return (data || []).map((r) => ({ movieId: r.movie_id, viewedAt: r.viewed_at }));
}

async function getWatchlistEntries(userId) {
  const { data, error } = await supabase
    .from('watchlist_items')
    .select('movie_id, added_at')
    .eq('user_id', userId);
  if (error) throw { status: 500, message: error.message };
  return (data || []).map((r) => ({ movieId: r.movie_id, addedAt: r.added_at }));
}

async function getDismissals(userId) {
  const { data, error } = await supabase
    .from('movie_dismissals')
    .select('movie_id, created_at')
    .eq('user_id', userId);
  if (error) return handleOptionalTableError(error, []);
  return (data || []).map((r) => ({ movieId: r.movie_id, createdAt: r.created_at }));
}

async function addDismissal(userId, movieId) {
  const numMovieId = Number(movieId);
  if (!Number.isFinite(numMovieId)) throw { status: 400, message: 'movieId ไม่ถูกต้อง' };
  const { error } = await supabase
    .from('movie_dismissals')
    .upsert({ user_id: userId, movie_id: numMovieId }, { onConflict: 'user_id,movie_id' });
  if (error) {
    if (error.code === '23503') throw { status: 404, message: 'ไม่พบภาพยนตร์ที่ระบุ' };
    if (isMissingTable(error)) {
      handleOptionalTableError(error, false);
      throw { status: 503, message: 'ฟีเจอร์ "ไม่สนใจ" ยังไม่พร้อมใช้งาน (ต้องรัน migration_recommendations.sql ก่อน)' };
    }
    throw { status: 500, message: error.message };
  }
  return true;
}

module.exports = {
  initDb,
  addReview,
  getReviews,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  recordView,
  getViewHistory,
  getWatchlistEntries,
  getDismissals,
  addDismissal
};
