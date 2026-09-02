const supabase = require('./supabase');

// mood (จากหน้า index.html mood-chip) -> genre ที่ควรแนะนำ
// mood 3 (เฉยๆ) = null คือไม่กรอง สุ่มจากทุกแนวได้เลย
const MOOD_GENRES = {
  1: ['Drama', 'Romance', 'Biography', 'History'],       // หดหู่
  2: ['Comedy', 'Animation', 'Family', 'Music'],          // เหนื่อยล้า อยากดูเบาสมอง
  3: null,                                                // เฉยๆ
  4: ['Adventure', 'Comedy', 'Action', 'Family'],         // อารมณ์ดี
  5: ['Action', 'Sci-Fi', 'Thriller', 'Fantasy', 'Crime'] // พลังล้น
};

function mapMovieRow(row) {
  return {
    id: row.id,
    title: row.title,
    mpaaRating: row.mpaa_rating,
    genre: row.genre,
    year: row.year,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    votes: row.votes,
    director: row.director,
    writer: row.writer,
    star: row.star,
    country: row.country,
    budget: row.budget,
    gross: row.gross,
    company: row.company,
    runtime: row.runtime,
    synopsis: row.synopsis,
    tags: Array.isArray(row.tags) ? row.tags : [],
    posterClass: row.poster_class || 'poster-drama',
    icon: row.icon || '🎬'
  };
}

// escape ค่าที่จะใส่ใน .or() filter ของ PostgREST (กันกรณีมี , หรือ " ในคำค้นหา)
function pgSafeLike(value) {
  return String(value).replace(/[%,()"]/g, ' ').trim();
}

/**
 * ดึงรายการภาพยนตร์ (จาก Supabase เท่านั้น — แหล่งข้อมูลเดียว)
 */
async function getAllMovies({ search, genre, tag, mood, limit } = {}) {
  let query = supabase.from('movies').select('*');

  if (search) {
    const q = pgSafeLike(search);
    if (q) query = query.or(`title.ilike.%${q}%,synopsis.ilike.%${q}%`);
  }

  if (genre) {
    query = query.ilike('genre', `%${pgSafeLike(genre)}%`);
  }

  if (tag) {
    query = query.contains('tags', [tag]);
  }

  if (mood) {
    const moodGenres = MOOD_GENRES[Number(mood)];
    if (moodGenres) query = query.in('genre', moodGenres);
  }

  query = query.order('score', { ascending: false, nullsFirst: false }).order('year', { ascending: false });

  const numLimit = Number(limit);
  if (Number.isFinite(numLimit) && numLimit > 0) {
    query = query.limit(numLimit);
  }

  const { data, error } = await query;
  if (error) throw { status: 500, message: error.message };
  return (data || []).map(mapMovieRow);
}

/**
 * ดึงข้อมูลหนังรายเรื่องด้วย ID
 */
async function getMovieById(id) {
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    throw { status: 400, message: 'รหัสภาพยนตร์ไม่ถูกต้อง' };
  }
  const { data, error } = await supabase.from('movies').select('*').eq('id', numId).maybeSingle();
  if (error) throw { status: 500, message: error.message };
  if (!data) throw { status: 404, message: 'ไม่พบข้อมูลภาพยนตร์ที่ระบุ' };
  return mapMovieRow(data);
}

module.exports = { getAllMovies, getMovieById, mapMovieRow };
