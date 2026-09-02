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

module.exports = { initDb, addReview, getReviews, getWatchlist, addToWatchlist, removeFromWatchlist };
