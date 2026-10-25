'use strict';
// ระบบผู้ดูแล (Admin)
// - รหัส admin มาจาก Environment: ADMIN_USERNAME (ค่าเริ่มต้น "admin") และ ADMIN_PASSWORD (บังคับ อย่างน้อย 8 ตัว)
// - Token ของ admin เซ็นด้วยกุญแจที่สร้างจาก ADMIN_PASSWORD + JWT_SECRET
//   => เปลี่ยน ADMIN_PASSWORD บน Render เมื่อไหร่ token admin เก่าทุกอันใช้ไม่ได้ทันที
//   => ต่อให้มีคนเห็นโค้ดใน GitHub ก็ปลอม token ไม่ได้ถ้าไม่รู้ ADMIN_PASSWORD

const crypto = require('crypto');
const supabase = require('./supabase');
const { mapMovieRow } = require('./movies');
const storage = require('./storage');

const MIN_ADMIN_PASSWORD = 8;

function sessionHours() {
  const n = Number(process.env.ADMIN_SESSION_HOURS);
  return Number.isFinite(n) && n > 0 && n <= 168 ? n : 8;
}

function adminCredentials() {
  return {
    username: (process.env.ADMIN_USERNAME || 'admin').trim(),
    password: process.env.ADMIN_PASSWORD || ''
  };
}

function adminStatus() {
  const { password } = adminCredentials();
  if (!password) return { ready: false, reason: 'ยังไม่ได้ตั้งค่า ADMIN_PASSWORD ใน Environment ของ server' };
  if (password.length < MIN_ADMIN_PASSWORD) return { ready: false, reason: `ADMIN_PASSWORD ต้องยาวอย่างน้อย ${MIN_ADMIN_PASSWORD} ตัวอักษร` };
  return { ready: true };
}

function assertAdminReady() {
  const status = adminStatus();
  if (!status.ready) throw { status: 503, message: `ระบบ Admin ยังไม่พร้อม: ${status.reason}` };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

// เทียบแบบเวลาคงที่ กันการเดารหัสจากเวลาตอบกลับ
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function signingKey() {
  const { password } = adminCredentials();
  return sha256(`cinesupernova-admin:${password}:${process.env.JWT_SECRET || ''}`);
}

function sign(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', signingKey()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function login({ username, password } = {}) {
  assertAdminReady();
  const creds = adminCredentials();
  // ใช้ & (ไม่ใช่ &&) ให้เช็คครบทั้งสองค่าเสมอ เวลาตอบกลับจะได้เท่ากัน
  const ok = safeEqual(String(username || '').trim(), creds.username) & safeEqual(String(password || ''), creds.password);
  if (!ok) throw { status: 401, message: 'ชื่อผู้ใช้หรือรหัสผ่าน Admin ไม่ถูกต้อง' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.round(sessionHours() * 3600);
  return {
    token: sign({ role: 'admin', sub: creds.username, iat: now, exp }),
    username: creds.username,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

function verifyToken(token) {
  assertAdminReady();
  const invalid = { status: 401, message: 'Session ของ Admin หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' };
  if (!token || typeof token !== 'string') throw invalid;
  const parts = token.split('.');
  if (parts.length !== 3) throw invalid;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac('sha256', signingKey()).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw invalid;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (e) {
    throw invalid;
  }
  if (payload.role !== 'admin' || !payload.exp || payload.exp * 1000 < Date.now()) throw invalid;
  return { username: payload.sub, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

// ---------------------------------------------------------------------------
// ตัวช่วยตรวจข้อมูลหนังที่ admin ส่งมา
// ---------------------------------------------------------------------------
const POSTER_CLASSES = [
  'poster-scifi', 'poster-drama', 'poster-romance', 'poster-comedy', 'poster-horror',
  'poster-action', 'poster-adventure', 'poster-animation', 'poster-crime', 'poster-fantasy'
];

function bad(message) {
  return { status: 400, message };
}

function optText(value, label, max = 300) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max) throw bad(`${label} ยาวเกิน ${max} ตัวอักษร`);
  return s;
}

function optInt(value, label, min, max) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} ต้องเป็นจำนวนเต็มระหว่าง ${min} ถึง ${max}`);
  return n;
}

function optNumber(value, label, min, max) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} ต้องเป็นตัวเลขระหว่าง ${min} ถึง ${max}`);
  return Math.round(n * 10) / 10;
}

function optUrl(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  let url;
  try {
    url = new URL(String(value).trim());
  } catch (e) {
    throw bad('ลิงก์รูปไม่ถูกต้อง');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad('ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://');
  if (url.href.length > 1000) throw bad('ลิงก์รูปยาวเกินไป');
  return url.href;
}

function optTags(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const tags = [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
  if (tags.length > 20) throw bad('ใส่แท็กได้ไม่เกิน 20 แท็ก');
  if (tags.some((t) => t.length > 40)) throw bad('แต่ละแท็กยาวได้ไม่เกิน 40 ตัวอักษร');
  return tags;
}

// รับ field แบบ camelCase (ตรงกับที่ API /api/movies คืนค่า) แล้วแปลงเป็นชื่อคอลัมน์ในฐานข้อมูล
function movieInputToRow(input = {}, { requireTitle = false } = {}) {
  const thisYear = new Date().getFullYear();
  const row = {
    title: optText(input.title, 'ชื่อเรื่อง', 300),
    mpaa_rating: optText(input.mpaaRating, 'เรต', 20),
    genre: optText(input.genre, 'แนวหนัง', 60),
    year: optInt(input.year, 'ปีที่ฉาย', 1870, thisYear + 10),
    score: optNumber(input.score, 'คะแนน', 0, 10),
    votes: optInt(input.votes, 'จำนวนโหวต', 0, 1e9),
    director: optText(input.director, 'ผู้กำกับ', 200),
    writer: optText(input.writer, 'ผู้เขียนบท', 300),
    star: optText(input.star, 'นักแสดงนำ', 200),
    country: optText(input.country, 'ประเทศ', 100),
    budget: optInt(input.budget, 'ทุนสร้าง', 0, 1e13),
    gross: optInt(input.gross, 'รายได้', 0, 1e13),
    company: optText(input.company, 'บริษัท', 200),
    runtime: optInt(input.runtime, 'ความยาว', 0, 1000),
    synopsis: optText(input.synopsis, 'เรื่องย่อ', 5000),
    tags: optTags(input.tags),
    icon: optText(input.icon, 'ไอคอน', 16),
    poster_url: optUrl(input.posterUrl)
  };
  if (input.posterClass !== undefined) {
    if (!POSTER_CLASSES.includes(input.posterClass)) throw bad('โทนสีโปสเตอร์ไม่ถูกต้อง');
    row.poster_class = input.posterClass;
  }
  for (const key of Object.keys(row)) {
    if (row[key] === undefined) delete row[key];
  }
  // คอลัมน์ที่เป็น not null ในตาราง ห้ามตั้งเป็น null
  if (row.icon === null) delete row.icon;
  if (requireTitle && !row.title) throw bad('ต้องใส่ชื่อเรื่อง');
  if (!requireTitle && 'title' in row && !row.title) throw bad('ชื่อเรื่องห้ามว่าง');
  return row;
}

function toId(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw bad(`${label} ไม่ถูกต้อง`);
  return n;
}

function pageParams({ page, limit }, maxLimit = 100) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(maxLimit, Math.max(1, parseInt(limit, 10) || 24));
  return { page: p, limit: l, from: (p - 1) * l, to: (p - 1) * l + l - 1 };
}

// ทำคำค้นให้ปลอดภัยสำหรับ .or()/.ilike() ของ PostgREST
function safeLike(value) {
  return String(value || '').replace(/[%,()"\\*]/g, ' ').trim().slice(0, 100);
}

function dbError(error) {
  if (error && (error.code === '42703' || /poster_url/.test(error.message || ''))) {
    return { status: 500, message: 'ยังไม่มีคอลัมน์ poster_url ในตาราง movies — รัน Backend/sql/migration_admin_reset.sql ใน Supabase ก่อน' };
  }
  return { status: 500, message: (error && error.message) || 'Database error' };
}

// ---------------------------------------------------------------------------
// ภาพรวม
// ---------------------------------------------------------------------------
async function countRows(table, build) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  if (error) throw dbError(error);
  return count || 0;
}

async function getStats() {
  const [users, movies, reviews, withPoster, watchlist] = await Promise.all([
    countRows('users'),
    countRows('movies'),
    countRows('reviews'),
    countRows('movies', (q) => q.not('poster_url', 'is', null)),
    countRows('watchlist_items')
  ]);
  const [{ data: recentReviews, error: rErr }, { data: recentUsers, error: uErr }] = await Promise.all([
    supabase.from('reviews').select('id, movie_id, author, rating, text, created_at, movies(title)').order('created_at', { ascending: false }).limit(5),
    supabase.from('users').select('id, username, email, created_at').order('created_at', { ascending: false }).limit(5)
  ]);
  if (rErr) throw dbError(rErr);
  if (uErr) throw dbError(uErr);
  return {
    users,
    movies,
    reviews,
    watchlistItems: watchlist,
    moviesWithPoster: withPoster,
    moviesWithoutPoster: Math.max(0, movies - withPoster),
    recentReviews: (recentReviews || []).map(mapAdminReview),
    recentUsers: (recentUsers || []).map(mapAdminUser)
  };
}

// ---------------------------------------------------------------------------
// หนัง
// ---------------------------------------------------------------------------
async function listMovies({ search, poster, page, limit } = {}) {
  const pg = pageParams({ page, limit });
  let q = supabase.from('movies').select('*', { count: 'exact' });
  const term = safeLike(search);
  if (term) {
    const idMatch = /^#?(\d+)$/.exec(term);
    q = idMatch
      ? q.eq('id', Number(idMatch[1]))
      : q.or(`title.ilike.%${term}%,director.ilike.%${term}%,star.ilike.%${term}%,genre.ilike.%${term}%`);
  }
  if (poster === 'missing') q = q.is('poster_url', null);
  if (poster === 'has') q = q.not('poster_url', 'is', null);
  q = q.order('id', { ascending: true }).range(pg.from, pg.to);
  const { data, error, count } = await q;
  if (error) throw dbError(error);
  const total = count || 0;
  return { items: (data || []).map(mapMovieRow), total, page: pg.page, limit: pg.limit, totalPages: Math.max(1, Math.ceil(total / pg.limit)) };
}

async function getMovie(id) {
  const { data, error } = await supabase.from('movies').select('*').eq('id', toId(id, 'รหัสหนัง')).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw { status: 404, message: 'ไม่พบหนังเรื่องนี้' };
  return data;
}

async function createMovie(input) {
  const row = movieInputToRow(input, { requireTitle: true });
  if (!row.poster_class) row.poster_class = 'poster-drama';
  if (!row.icon) row.icon = '🎬';
  if (!row.tags) row.tags = [];
  const { data, error } = await supabase.from('movies').insert(row).select('*').single();
  if (error) {
    if (error.code === '23505') {
      throw { status: 409, message: 'รหัสหนังชนกับของเดิม — รัน migration_admin_reset.sql อีกครั้งเพื่อรีเซ็ตตัวนับ id' };
    }
    throw dbError(error);
  }
  return mapMovieRow(data);
}

async function updateMovie(id, input) {
  const movieId = toId(id, 'รหัสหนัง');
  const row = movieInputToRow(input);
  if (!Object.keys(row).length) throw bad('ไม่มีข้อมูลที่จะแก้ไข');
  const before = 'poster_url' in row ? await getMovie(movieId) : null;
  const { data, error } = await supabase.from('movies').update(row).eq('id', movieId).select('*').maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw { status: 404, message: 'ไม่พบหนังเรื่องนี้' };
  if (before && before.poster_url && before.poster_url !== data.poster_url) {
    await storage.removePosterByUrl(before.poster_url);
  }
  return mapMovieRow(data);
}

async function deleteMovie(id) {
  const movie = await getMovie(id);
  const { error } = await supabase.from('movies').delete().eq('id', movie.id);
  if (error) throw dbError(error);
  if (movie.poster_url) await storage.removePosterByUrl(movie.poster_url);
  return { id: movie.id, title: movie.title };
}

async function setPoster(id, { image, url } = {}) {
  const movie = await getMovie(id);
  let newUrl;
  let meta = {};
  if (image) {
    const uploaded = await storage.uploadPoster(movie.id, image);
    newUrl = uploaded.url;
    meta = { bytes: uploaded.bytes, mime: uploaded.mime };
  } else if (url) {
    newUrl = optUrl(url);
  } else {
    throw bad('ต้องส่งไฟล์รูป (image) หรือลิงก์รูป (url) มาอย่างใดอย่างหนึ่ง');
  }
  const { data, error } = await supabase.from('movies').update({ poster_url: newUrl }).eq('id', movie.id).select('*').maybeSingle();
  if (error) throw dbError(error);
  if (movie.poster_url && movie.poster_url !== newUrl) await storage.removePosterByUrl(movie.poster_url);
  return { movie: mapMovieRow(data), ...meta };
}

async function removePoster(id) {
  const movie = await getMovie(id);
  const { data, error } = await supabase.from('movies').update({ poster_url: null }).eq('id', movie.id).select('*').maybeSingle();
  if (error) throw dbError(error);
  if (movie.poster_url) await storage.removePosterByUrl(movie.poster_url);
  return mapMovieRow(data);
}

async function moviesMissingPoster(limit) {
  const { data, error } = await supabase
    .from('movies')
    .select('*')
    .is('poster_url', null)
    .order('votes', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw dbError(error);
  return data || [];
}

// ---------------------------------------------------------------------------
// ผู้ใช้
// ---------------------------------------------------------------------------
function mapAdminUser(row) {
  return { id: row.id, username: row.username, email: row.email, createdAt: row.created_at };
}

async function listUsers({ search, page, limit } = {}) {
  const pg = pageParams({ page, limit }, 100);
  let q = supabase.from('users').select('id, username, email, created_at', { count: 'exact' });
  const term = safeLike(search);
  if (term) q = q.or(`username.ilike.%${term}%,email.ilike.%${term}%`);
  q = q.order('id', { ascending: false }).range(pg.from, pg.to);
  const { data, error, count } = await q;
  if (error) throw dbError(error);
  const users = (data || []).map(mapAdminUser);

  // นับรีวิวของผู้ใช้ในหน้านี้ (query เดียว)
  if (users.length) {
    const { data: rows, error: rErr } = await supabase.from('reviews').select('user_id').in('user_id', users.map((u) => u.id));
    if (rErr) throw dbError(rErr);
    const counts = new Map();
    for (const r of rows || []) counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1);
    users.forEach((u) => { u.reviewCount = counts.get(u.id) || 0; });
  }
  const total = count || 0;
  return { items: users, total, page: pg.page, limit: pg.limit, totalPages: Math.max(1, Math.ceil(total / pg.limit)) };
}

async function getUserRow(id) {
  const { data, error } = await supabase.from('users').select('id, username, email, created_at').eq('id', toId(id, 'รหัสผู้ใช้')).maybeSingle();
  if (error) throw dbError(error);
  if (!data) throw { status: 404, message: 'ไม่พบผู้ใช้' };
  return data;
}

async function deleteUser(id) {
  const user = await getUserRow(id);
  const { error } = await supabase.from('users').delete().eq('id', user.id);
  if (error) throw dbError(error);
  return mapAdminUser(user);
}

async function logoutUser(id) {
  const user = await getUserRow(id);
  const { error } = await supabase.from('sessions').delete().eq('user_id', user.id);
  if (error) throw dbError(error);
  return mapAdminUser(user);
}

// ---------------------------------------------------------------------------
// รีวิว
// ---------------------------------------------------------------------------
function mapAdminReview(row) {
  return {
    id: row.id,
    movieId: row.movie_id,
    movieTitle: row.movies ? row.movies.title : null,
    userId: row.user_id ?? null,
    author: row.author,
    rating: Number(row.rating),
    text: row.text,
    spoiler: Boolean(row.spoiler),
    createdAt: row.created_at
  };
}

async function listReviews({ search, movieId, page, limit } = {}) {
  const pg = pageParams({ page, limit }, 100);
  let q = supabase.from('reviews').select('*, movies(title)', { count: 'exact' });
  if (movieId) q = q.eq('movie_id', toId(movieId, 'รหัสหนัง'));
  const term = safeLike(search);
  if (term) q = q.or(`author.ilike.%${term}%,text.ilike.%${term}%`);
  q = q.order('created_at', { ascending: false }).range(pg.from, pg.to);
  const { data, error, count } = await q;
  if (error) throw dbError(error);
  const total = count || 0;
  return { items: (data || []).map(mapAdminReview), total, page: pg.page, limit: pg.limit, totalPages: Math.max(1, Math.ceil(total / pg.limit)) };
}

async function deleteReview(id) {
  const reviewId = toId(id, 'รหัสรีวิว');
  const { data, error } = await supabase.from('reviews').delete().eq('id', reviewId).select('id');
  if (error) throw dbError(error);
  if (!data || !data.length) throw { status: 404, message: 'ไม่พบรีวิวนี้' };
  return { id: reviewId };
}

// ---------------------------------------------------------------------------
// เช็คว่าฐานข้อมูลพร้อมไหม (ใช้ในแท็บ "ตั้งค่าระบบ")
// ---------------------------------------------------------------------------
async function checkDatabase() {
  const result = { posterColumn: false, passwordResetsTable: false };
  const { error: colErr } = await supabase.from('movies').select('poster_url').limit(1);
  result.posterColumn = !colErr;
  const { error: tblErr } = await supabase.from('password_resets').select('id').limit(1);
  result.passwordResetsTable = !tblErr;
  return result;
}

module.exports = {
  adminStatus,
  adminCredentials,
  login,
  verifyToken,
  getStats,
  listMovies,
  getMovie: async (id) => mapMovieRow(await getMovie(id)),
  createMovie,
  updateMovie,
  deleteMovie,
  setPoster,
  removePoster,
  moviesMissingPoster,
  listUsers,
  getUserRow,
  deleteUser,
  logoutUser,
  listReviews,
  deleteReview,
  checkDatabase,
  POSTER_CLASSES
};
