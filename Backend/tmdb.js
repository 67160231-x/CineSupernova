'use strict';
// (ไม่บังคับ) ค้นหาโปสเตอร์หนังจาก TMDB อัตโนมัติ
// เปิดใช้โดยตั้ง Environment: TMDB_API_KEY (ใช้ได้ทั้ง "API Key" v3 หรือ "API Read Access Token" v4)
// สมัครฟรีที่ https://www.themoviedb.org/settings/api
// ถ้าไม่ตั้ง ระบบ admin ก็ยังอัปโหลดรูปเองได้ตามปกติ แค่ปุ่ม "ค้นหาจาก TMDB" จะถูกซ่อน

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

let fetchImpl = (...args) => fetch(...args);

function apiKey() {
  return (process.env.TMDB_API_KEY || '').trim();
}

function isEnabled() {
  return Boolean(apiKey());
}

async function callSearch(params) {
  const key = apiKey();
  const headers = { Accept: 'application/json' };
  const query = new URLSearchParams(params);
  // token v4 เป็น JWT ขึ้นต้นด้วย eyJ ส่งผ่าน header / key v3 ส่งผ่าน query string
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  else query.set('api_key', key);

  const res = await fetchImpl(`https://api.themoviedb.org/3/search/movie?${query.toString()}`, { headers });
  if (res.status === 401) throw { status: 502, message: 'TMDB_API_KEY ไม่ถูกต้อง (TMDB ตอบกลับ 401)' };
  if (!res.ok) throw { status: 502, message: `TMDB ตอบกลับ ${res.status}` };
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

async function searchPosters({ title, year }) {
  if (!isEnabled()) throw { status: 503, message: 'ยังไม่ได้ตั้ง TMDB_API_KEY ใน Environment' };
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw { status: 400, message: 'ต้องระบุชื่อหนังที่จะค้นหา' };

  const base = { query: cleanTitle, include_adult: 'false', language: 'en-US', page: '1' };
  let results = [];
  if (year) results = await callSearch({ ...base, year: String(year) });
  // ปีในข้อมูลเราอาจไม่ตรงกับปีฉายใน TMDB (เช่นฉายเทศกาลก่อน) ลองค้นแบบไม่ใส่ปีอีกรอบ
  if (!results.length) results = await callSearch(base);

  return results
    .filter((r) => r.poster_path)
    .slice(0, 8)
    .map((r) => ({
      tmdbId: r.id,
      title: r.title || r.original_title || '',
      year: (r.release_date || '').slice(0, 4),
      posterUrl: `${IMAGE_BASE}/w500${r.poster_path}`,
      thumbUrl: `${IMAGE_BASE}/w185${r.poster_path}`
    }));
}

module.exports = {
  isEnabled,
  searchPosters,
  setFetchForTests(fn) {
    fetchImpl = fn;
  }
};
