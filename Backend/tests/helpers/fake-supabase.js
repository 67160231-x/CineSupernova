'use strict';
// Supabase จำลองในหน่วยความจำ (เฉพาะส่วนที่โค้ดของโปรเจกต์เรียกใช้)
// ไว้เทสต์ API แบบออฟไลน์ ไม่ต้องใช้ SUPABASE_URL / SERVICE_ROLE_KEY จริง
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
    icon: '🎬',
    poster_url: null
  }));
}

// คอลัมน์ unique ของแต่ละตาราง (จำลอง error 23505)
const UNIQUE = {
  users: [['username'], ['email']],
  password_resets: [['token_hash']]
};
const AUTO_ID = new Set(['users', 'movies', 'reviews', 'movie_views', 'password_resets']);

// แปลง pattern ของ LIKE/ILIKE เป็น RegExp (รองรับ \% \_ แบบ escape)
function likeToRegex(pattern) {
  let out = '';
  const s = String(pattern);
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      out += s[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    } else if (c === '%' || c === '*') out += '.*';
    else if (c === '_') out += '.';
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'is');
}

// แยก "a.eq.x,b.ilike.%y%" -> [{col,op,val}] (รองรับค่าที่ครอบด้วย "")
function parseOr(expr) {
  const parts = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (c === '\\' && quoted) { cur += c + (expr[i + 1] || ''); i += 1; continue; }
    if (c === '"') quoted = !quoted;
    if (c === ',' && !quoted) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => {
    const first = p.indexOf('.');
    const second = p.indexOf('.', first + 1);
    let val = p.slice(second + 1);
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
    return { col: p.slice(0, first), op: p.slice(first + 1, second), val };
  });
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
      movie_dismissals: [],
      password_resets: []
    },
    missing: new Set(), // ชื่อตารางที่ "ยังไม่ได้สร้าง" (จำลองกรณียังไม่รัน migration)
    seq: { reviews: 0, movie_views: 0 },
    buckets: new Map(),
    objects: new Map()
  };

  function nextId(table) {
    const rows = state.tables[table];
    return rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
  }

  function withJoins(table, row, cols) {
    if (!cols || !/movies\(/.test(cols) || table === 'movies') return row;
    const movie = state.tables.movies.find((m) => m.id === row.movie_id) || null;
    return { ...row, movies: movie ? { ...movie } : null };
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.sort = [];
      this.max = null;
      this.rangeFrom = null;
      this.rangeTo = null;
      this.payload = null;
      this.opts = null;
      this.cols = '*';
      this.countMode = null;
      this.head = false;
      this.returning = false;
      this.singleMode = null;
    }
    select(cols, opts = {}) {
      if (this.op === 'select') {
        this.cols = cols || '*';
        this.countMode = opts.count || null;
        this.head = Boolean(opts.head);
      } else {
        this.returning = true;
      }
      return this;
    }
    eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
    in(col, arr) { this.filters.push((r) => arr.includes(r[col])); return this; }
    gte(col, val) { this.filters.push((r) => r[col] >= val); return this; }
    is(col, val) { this.filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val)); return this; }
    not(col, op, val) {
      if (op === 'is' && val === null) this.filters.push((r) => r[col] !== null && r[col] !== undefined);
      else this.filters.push((r) => r[col] !== val);
      return this;
    }
    ilike(col, pattern) {
      const re = likeToRegex(pattern);
      this.filters.push((r) => r[col] !== null && r[col] !== undefined && re.test(String(r[col])));
      return this;
    }
    contains(col, arr) { this.filters.push((r) => Array.isArray(r[col]) && arr.every((v) => r[col].includes(v))); return this; }
    or(expr) {
      const conds = parseOr(expr);
      this.filters.push((r) => conds.some(({ col, op, val }) => {
        if (op === 'eq') return String(r[col]) === val;
        if (op === 'ilike') return r[col] != null && likeToRegex(val).test(String(r[col]));
        throw new Error(`fake or(): unsupported op ${op}`);
      }));
      return this;
    }
    order(col, o = {}) { this.sort.push([col, o.ascending !== false]); return this; }
    limit(n) { this.max = n; return this; }
    range(from, to) { this.rangeFrom = from; this.rangeTo = to; return this; }
    insert(row) { this.op = 'insert'; this.payload = row; return this; }
    upsert(row, opts) { this.op = 'upsert'; this.payload = row; this.opts = opts; return this; }
    update(patch) { this.op = 'update'; this.payload = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    maybeSingle() { this.singleMode = 'maybe'; return this; }
    single() { this.singleMode = 'single'; return this; }

    finish(rows) {
      if (this.singleMode) {
        if (this.singleMode === 'single' && rows.length !== 1) {
          return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
        }
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    }

    run() {
      if (state.missing.has(this.table)) {
        return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };
      }
      const rows = state.tables[this.table];
      if (!rows) return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };

      if (this.op === 'insert' || this.op === 'upsert') {
        const input = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inserted = [];
        for (const original of input) {
          const row = { ...original };
          if (row.movie_id !== undefined && !state.tables.movies.some((m) => m.id === row.movie_id)) {
            return { data: null, error: { code: '23503', message: 'foreign key violation' } };
          }
          if (this.op === 'upsert') {
            const keys = this.opts.onConflict.split(',');
            const i = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
            if (i >= 0) { rows[i] = { ...rows[i], ...row }; inserted.push(rows[i]); continue; }
          }
          for (const cols of UNIQUE[this.table] || []) {
            if (rows.some((r) => cols.every((c) => r[c] === row[c]))) {
              return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint (${cols.join(',')})` } };
            }
          }
          if (AUTO_ID.has(this.table) && row.id === undefined) row.id = nextId(this.table);
          if (!row.created_at && !row.viewed_at && this.table !== 'movies') {
            if (this.table === 'movie_views') row.viewed_at = new Date().toISOString();
            else row.created_at = new Date().toISOString();
          }
          rows.push(row);
          inserted.push(row);
        }
        return this.finish(this.returning ? inserted.map((r) => ({ ...r })) : (this.singleMode ? inserted : []));
      }

      let out = rows.filter((r) => this.filters.every((f) => f(r)));

      if (this.op === 'delete') {
        state.tables[this.table] = rows.filter((r) => !out.includes(r));
        return this.finish(this.returning ? out.map((r) => ({ ...r })) : []);
      }

      if (this.op === 'update') {
        for (const r of out) Object.assign(r, this.payload);
        return this.finish(this.returning ? out.map((r) => ({ ...r })) : []);
      }

      for (const [col, asc] of [...this.sort].reverse()) {
        out = out.slice().sort((a, b) => {
          const av = a[col] ?? -Infinity; const bv = b[col] ?? -Infinity;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      const count = out.length;
      if (this.rangeFrom !== null) out = out.slice(this.rangeFrom, this.rangeTo + 1);
      if (this.max !== null) out = out.slice(0, this.max);
      if (this.head) return { data: null, error: null, count };
      const mapped = out.map((r) => withJoins(this.table, { ...r }, this.cols));
      const result = this.finish(mapped);
      if (this.countMode) result.count = count;
      return result;
    }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
  }

  const storage = {
    async getBucket(id) {
      return state.buckets.has(id) ? { data: state.buckets.get(id), error: null } : { data: null, error: { message: 'Bucket not found' } };
    },
    async createBucket(id, opts = {}) {
      if (state.buckets.has(id)) return { data: null, error: { message: 'The resource already exists' } };
      state.buckets.set(id, { id, ...opts });
      return { data: { name: id }, error: null };
    },
    from(bucket) {
      return {
        async upload(objectPath, body, opts = {}) {
          state.objects.set(`${bucket}/${objectPath}`, { body, contentType: opts.contentType });
          return { data: { path: objectPath }, error: null };
        },
        getPublicUrl(objectPath) {
          return { data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${objectPath}` } };
        },
        async remove(paths) {
          for (const p of paths) state.objects.delete(`${bucket}/${p}`);
          return { data: paths, error: null };
        }
      };
    }
  };

  return { state, client: { from: (table) => new Query(table), storage } };
}

module.exports = { createFake };
