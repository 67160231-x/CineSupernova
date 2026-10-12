/**
 * ตรรกะกรอง/ค้นหาหนังของหน้า search.html (แยกเป็นไฟล์ล้วนๆ ไม่แตะ DOM)
 * ใช้ได้ทั้งในเบราว์เซอร์ (window.SearchFilters) และ Node (require) เพื่อเขียนเทสต์ได้
 *
 * สาเหตุของบั๊ก "เลือก Vibe แล้วหาไม่เจอ": ปุ่ม Vibe เป็นข้อความไทย (เช่น "ตับพัง 3 วัน")
 * แต่ข้อมูลหนังใน Supabase ติดแท็กเป็นคำอังกฤษ (horror, thriller, sci-fi ...) จึงไม่เคยตรงกัน
 * ตอนนี้แต่ละ Vibe ถูกแปลงเป็นกติกา "แนวหนัง + แท็ก" ที่มีอยู่จริงในข้อมูล
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SearchFilters = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  // ชื่อแนวหนัง (ค่าใน DB เป็นอังกฤษ) -> ชื่อที่แสดงเป็นไทย
  const GENRE_LABELS = {
    Action: 'แอ็กชัน',
    Adventure: 'ผจญภัย',
    Animation: 'แอนิเมชัน / อนิเมะ',
    Biography: 'ชีวประวัติ',
    Comedy: 'คอมเมดี้',
    Crime: 'อาชญากรรม',
    Documentary: 'สารคดี',
    Drama: 'ดราม่า',
    Family: 'ครอบครัว',
    Fantasy: 'แฟนตาซี',
    History: 'ประวัติศาสตร์',
    Horror: 'สยองขวัญ',
    Music: 'ดนตรี',
    Musical: 'มิวสิคัล',
    Mystery: 'ลึกลับ / สืบสวน',
    Romance: 'โรแมนติก (รัก)',
    'Sci-Fi': 'ไซไฟ',
    Sport: 'กีฬา',
    Thriller: 'ระทึกขวัญ',
    War: 'สงคราม',
    Western: 'คาวบอย'
  };

  // Vibe (ภาษาไทย) -> แนวหนัง/แท็กอังกฤษที่เข้ากัน (ตรงกับชื่อแท็กในข้อมูลจริง)
  const VIBES = {
    'หักมุมจนหัวหมุน': { genres: ['Mystery', 'Thriller'], tags: ['mystery', 'thriller', 'twist', 'psychological'] },
    'ตับพัง 3 วัน': { genres: ['Drama', 'Romance', 'Biography', 'War'], tags: ['drama', 'romance', 'tragedy', 'period'] },
    'ดูจบแล้วอยากกอดใครสักคน': { genres: ['Family', 'Animation', 'Romance', 'Music', 'Musical'], tags: ['family', 'animation', 'musical', 'romance', 'heartwarming', 'feel-good'] },
    'ปิดไฟดูคนเดียวเท่านั้น': { genres: ['Horror', 'Thriller'], tags: ['horror', 'supernatural', 'zombie', 'survival', 'monster'] },
    'ฮาจนสำลักป๊อปคอร์น': { genres: ['Comedy'], tags: ['comedy', 'parody', 'buddy'] },
    'วิทยาศาสตร์งงแต่เท่': { genres: ['Sci-Fi', 'Mystery', 'Fantasy'], tags: ['sci-fi', 'mystery', 'fantasy'] }
  };

  const SORTS = {
    score: 'คะแนนสูงสุด',
    newest: 'ใหม่ล่าสุด',
    oldest: 'เก่าสุด',
    title: 'ชื่อเรื่อง A → Z'
  };

  const lower = (v) => String(v === null || v === undefined ? '' : v).toLowerCase();
  const genreLabel = (g) => GENRE_LABELS[g] || g;
  const movieTags = (m) => (Array.isArray(m.tags) ? m.tags : []);

  function matchesVibe(movie, vibe) {
    const tags = movieTags(movie).map(lower);
    if (tags.includes(lower(vibe))) return true; // เผื่ออนาคตมีแท็กภาษาไทยในข้อมูลจริง
    const rule = VIBES[vibe];
    if (!rule) return false;
    if (rule.genres.some((g) => lower(g) === lower(movie.genre))) return true;
    return rule.tags.some((t) => tags.includes(lower(t)));
  }

  function searchableText(m) {
    return [m.title, m.genre, genreLabel(m.genre), m.director, m.star, m.synopsis, m.country, movieTags(m).join(' ')]
      .map(lower).join(' ');
  }

  const toNum = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  /** สรุปตัวเลือกที่มีอยู่จริงในข้อมูล: แนว (พร้อมจำนวน) และช่วงปี */
  function buildFacets(movies) {
    const counts = new Map();
    const years = new Set();
    movies.forEach((m) => {
      if (m.genre) counts.set(m.genre, (counts.get(m.genre) || 0) + 1);
      if (Number.isFinite(Number(m.year))) years.add(Number(m.year));
    });
    const genres = [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: genreLabel(value) }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const yearList = [...years].sort((a, b) => b - a);
    return { genres, years: yearList };
  }

  /**
   * กรองและเรียงหนัง
   * state: { q, vibes:[], genres:[], yearFrom, yearTo, minScore, sort }
   * - ภายในกลุ่มเดียวกัน (vibe หลายอัน / แนวหลายแนว) = "หรือ"
   * - ข้ามกลุ่ม (คำค้น + vibe + แนว + ปี + คะแนน) = "และ"
   */
  function applyFilters(movies, state = {}) {
    const words = lower(state.q).split(/\s+/).filter(Boolean);
    const vibes = state.vibes ? [...state.vibes] : [];
    const genres = new Set((state.genres ? [...state.genres] : []).map(lower));
    let from = toNum(state.yearFrom);
    let to = toNum(state.yearTo);
    if (from !== null && to !== null && from > to) [from, to] = [to, from];
    const minScore = toNum(state.minScore);

    const out = movies.filter((m) => {
      if (words.length) {
        const text = searchableText(m);
        if (!words.every((w) => text.includes(w))) return false;
      }
      if (vibes.length && !vibes.some((v) => matchesVibe(m, v))) return false;
      if (genres.size && !genres.has(lower(m.genre))) return false;
      const y = toNum(m.year);
      if (from !== null && (y === null || y < from)) return false;
      if (to !== null && (y === null || y > to)) return false;
      if (minScore !== null && (m.score === null || m.score === undefined || Number(m.score) < minScore)) return false;
      return true;
    });

    const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1);
    const byYear = (a, b) => (b.year ?? 0) - (a.year ?? 0);
    const sorters = {
      score: (a, b) => byScore(a, b) || byYear(a, b),
      newest: (a, b) => byYear(a, b) || byScore(a, b),
      oldest: (a, b) => -byYear(a, b) || byScore(a, b),
      title: (a, b) => String(a.title).localeCompare(String(b.title), 'en', { sensitivity: 'base' })
    };
    return [...out].sort(sorters[state.sort] || sorters.score);
  }

  /** มีตัวกรองใดทำงานอยู่ไหม (ไว้โชว์ปุ่ม "ล้างตัวกรอง") */
  function hasActiveFilters(state = {}) {
    return Boolean(
      (state.q && String(state.q).trim()) ||
      (state.vibes && [...state.vibes].length) ||
      (state.genres && [...state.genres].length) ||
      toNum(state.yearFrom) !== null || toNum(state.yearTo) !== null || toNum(state.minScore) !== null
    );
  }

  return { GENRE_LABELS, VIBES, SORTS, genreLabel, matchesVibe, buildFacets, applyFilters, hasActiveFilters };
}));
