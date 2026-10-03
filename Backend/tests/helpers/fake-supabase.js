'use strict';
// Supabase จำลองในหน่วยความจำ (เฉพาะส่วนที่โค้ดของโปรเจกต์เรียกใช้)
// ไว้เทสต์ API ของระบบแนะนำหนังแบบออฟไลน์ ไม่ต้องใช้ SUPABASE_URL / SERVICE_ROLE_KEY จริง
// ข้อมูลหนังโหลดจาก data/cleaned_movies.json โดย id = ลำดับในไฟล์ (เหมือน seed_movies.sql)

const path = require('path');
const raw = require(path.join(__dirname, '../../data/cleaned_movies.json'));

function buildMovies() {
  return raw.map((m, i) => ({
    id: i + 1,
    title: m.name,
    mpaa_rating: m.rating,
    genre: m.genre,
    year: m.year,
    score: m.score,
    votes: m.votes,
    director: m.director,
    writer: m.writer,
    star: m.star,
    country: m.country,
    budget: m.budget,
    gross: m.gross,
    company: m.company,
    runtime: m.runtime,
    synopsis: '',
    tags: [],
    poster_class: 'poster-drama',
    icon: '🎬'
  }));
}

function createFake() {
  const state = {
    tables: {
      movies: buildMovies(),
      users: [],
      sessions: [],
      reviews: [],
      watchlist_items: [],
      movie_views: [],
      movie_dismissals: []
    },
    missing: new Set(), // ชื่อตารางที่ "ยังไม่ได้สร้าง" (จำลองกรณียังไม่รัน migration)
    seq: { reviews: 0, movie_views: 0 }
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.sort = [];
      this.max = null;
      this.payload = null;
      this.opts = null;
    }
    select() { return this; }
    eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
    in(col, arr) { this.filters.push((r) => arr.includes(r[col])); return this; }
    gte(col, val) { this.filters.push((r) => r[col] >= val); return this; }
    order(col, o = {}) { this.sort.push([col, o.ascending !== false]); return this; }
    limit(n) { this.max = n; return this; }
    insert(row) { this.op = 'insert'; this.payload = row; return this; }
    upsert(row, opts) { this.op = 'upsert'; this.payload = row; this.opts = opts; return this; }
    delete() { this.op = 'delete'; return this; }
    maybeSingle() { this.single = true; return this; }

    run() {
      if (state.missing.has(this.table)) {
        return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };
      }
      const rows = state.tables[this.table];
      if (this.op === 'insert' || this.op === 'upsert') {
        const row = { ...this.payload };
        if (row.movie_id !== undefined && !state.tables.movies.some((m) => m.id === row.movie_id)) {
          return { data: null, error: { code: '23503', message: 'foreign key violation' } };
        }
        if (this.op === 'upsert') {
          const keys = this.opts.onConflict.split(',');
          const i = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (i >= 0) { rows[i] = { ...rows[i], ...row }; return { data: null, error: null }; }
        }
        if (!row.created_at && !row.viewed_at) {
          if (this.table === 'movie_views') row.viewed_at = new Date().toISOString();
          else row.created_at = new Date().toISOString();
        }
        rows.push(row);
        return { data: null, error: null };
      }
      let out = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'delete') {
        state.tables[this.table] = rows.filter((r) => !out.includes(r));
        return { data: null, error: null };
      }
      for (const [col, asc] of [...this.sort].reverse()) {
        out = out.slice().sort((a, b) => {
          const av = a[col] ?? -Infinity; const bv = b[col] ?? -Infinity;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this.max !== null) out = out.slice(0, this.max);
      if (this.single) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
  }

  return { state, client: { from: (table) => new Query(table) } };
}

module.exports = { createFake };
