'use strict';

/**
 * Supabase จำลองในหน่วยความจำ (เลียนแบบ query builder ของ supabase-js / PostgREST เฉพาะส่วนที่โปรเจกต์นี้ใช้)
 * ใช้เทสต์ API แบบออฟไลน์ ไม่ต้องมี SUPABASE_URL / SERVICE_ROLE_KEY และไม่แตะฐานข้อมูลจริง
 *
 *   const { createMemorySupabase, installMemorySupabase } = require('./helpers/memory-supabase');
 *   installMemorySupabase();              // ต้องเรียกก่อน require('../server') / require('../auth')
 *
 * ข้อมูลหนังตั้งต้นมาจาก tests/fixtures/seed-movies.json (สร้างจาก sql/seed_movies.sql — 50 เรื่อง)
 */

const crypto = require('crypto');
const path = require('path');

const SEED = require(path.join(__dirname, '../fixtures/seed-movies.json'));

// ตาราง -> คอลัมน์ id อัตโนมัติ (bigserial)
const AUTO_ID = new Set(['users', 'movies', 'reviews', 'movie_views', 'password_resets']);
// ชุดคอลัมน์ที่ต้องไม่ซ้ำ (primary key / unique) — ตรงกับ sql/schema.sql
const UNIQUES = {
  users: [['id'], ['username'], ['email']],
  movies: [['id']],
  sessions: [['jti']],
  reviews: [['id']],
  watchlist_items: [['user_id', 'movie_id']],
  movie_dismissals: [['user_id', 'movie_id']],
  movie_views: [['id']],
  password_resets: [['id'], ['token_hash']]
};
const CONFLICT_DEFAULT = {
  watchlist_items: ['user_id', 'movie_id'],
  movie_dismissals: ['user_id', 'movie_id'],
  sessions: ['jti']
};
const TABLE_TS = { users: 'created_at', sessions: 'created_at', reviews: 'created_at', movie_views: 'viewed_at', movie_dismissals: 'created_at', watchlist_items: 'added_at', password_resets: 'created_at' };
// ตารางลูกที่ถูกลบตามเมื่อลบ user (on delete cascade / set null)
const USER_CASCADE = ['sessions', 'watchlist_items', 'movie_views', 'movie_dismissals', 'password_resets'];

const nowIso = () => new Date().toISOString();
const same = (a, b) => (a === null || a === undefined || b === null || b === undefined ? a === b : String(a) === String(b));

function cmp(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  const na = Number(a), nb = Number(b);
  if (typeof a !== 'string' || typeof b !== 'string') {
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  }
  const da = Date.parse(a), db = Date.parse(b);
  if (typeof a === 'string' && typeof b === 'string' && !Number.isNaN(da) && !Number.isNaN(db) && /\d{4}-\d{2}-\d{2}/.test(a)) return da - db;
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== '' && b !== '') return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function likeToRegex(pattern, insensitive) {
  let src = '';
  const str = String(pattern);
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '\\' && i + 1 < str.length) { i += 1; src += str[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } // \% \_ \\ = ตัวอักษรจริง
    else if (ch === '%') src += '.*';
    else if (ch === '_') src += '.';
    else src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${src}$`, insensitive ? 'is' : 's');
}

// แยก "a.eq.1,b.ilike.%x%" ตามเครื่องหมายจุลภาคที่อยู่นอก "..." (...) {...}
function splitTop(str) {
  const parts = [];
  let depth = 0, quote = false, cur = '';
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '\\' && quote) { cur += ch + (str[i + 1] || ''); i += 1; continue; }
    if (ch === '"') quote = !quote;
    else if (!quote && (ch === '(' || ch === '{')) depth += 1;
    else if (!quote && (ch === ')' || ch === '}')) depth -= 1;
    if (ch === ',' && !quote && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

const unquote = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v);
const parseList = (v) => splitTop(v.replace(/^[({]|[)}]$/g, '')).map((x) => unquote(x.trim()));

function makeFilter(col, op, val) {
  switch (op) {
    case 'eq': return (r) => same(r[col], val);
    case 'neq': return (r) => !same(r[col], val);
    case 'gt': return (r) => cmp(r[col], val) > 0 && r[col] != null;
    case 'gte': return (r) => r[col] != null && cmp(r[col], val) >= 0;
    case 'lt': return (r) => r[col] != null && cmp(r[col], val) < 0;
    case 'lte': return (r) => r[col] != null && cmp(r[col], val) <= 0;
    case 'like': return (r) => r[col] != null && likeToRegex(val, false).test(String(r[col]));
    case 'ilike': return (r) => r[col] != null && likeToRegex(val, true).test(String(r[col]));
    case 'is': return (r) => (val === null || val === 'null' ? r[col] === null || r[col] === undefined : r[col] === (val === 'true'));
    case 'in': return (r) => (Array.isArray(val) ? val : parseList(String(val))).some((x) => same(r[col], x));
    case 'cs': case 'contains': return (r) => Array.isArray(r[col]) && (Array.isArray(val) ? val : parseList(String(val))).every((x) => r[col].includes(x));
    case 'ov': case 'overlaps': return (r) => Array.isArray(r[col]) && (Array.isArray(val) ? val : parseList(String(val))).some((x) => r[col].includes(x));
    default: throw new Error(`memory-supabase: ไม่รองรับ operator "${op}"`);
  }
}

function parseOr(str) {
  const fs = splitTop(str).map((part) => {
    const m = part.match(/^([\w]+)\.(\w+)\.([\s\S]*)$/);
    if (!m) throw new Error(`memory-supabase: parse or() ไม่ได้: ${part}`);
    const [, col, op, raw] = m;
    const val = ['in', 'cs', 'ov'].includes(op) ? raw : unquote(raw);
    return makeFilter(col, op, val);
  });
  return (r) => fs.some((f) => f(r));
}

function createMemorySupabase({ movies } = {}) {
  const tables = {
    movies: (movies || SEED).map((m) => ({ ...m })),
    users: [], sessions: [], reviews: [], watchlist_items: [], movie_views: [], movie_dismissals: [], password_resets: []
  };
  const seq = {};
  tables.movies.forEach((m) => { seq.movies = Math.max(seq.movies || 0, m.id); });
  const missing = new Set();

  const nextId = (t) => { seq[t] = (seq[t] || 0) + 1; return seq[t]; };

  function applyDefaults(table, row) {
    const r = { ...row };
    if (AUTO_ID.has(table) && (r.id === undefined || r.id === null)) r.id = nextId(table);
    if (table === 'sessions' && !r.jti) r.jti = crypto.randomUUID();
    if (TABLE_TS[table] && r[TABLE_TS[table]] === undefined) r[TABLE_TS[table]] = nowIso();
    if (table === 'reviews') { if (r.spoiler === undefined) r.spoiler = false; if (r.rating === undefined) r.rating = 0; if (r.text === undefined) r.text = ''; }
    if (table === 'movies') { if (!Array.isArray(r.tags)) r.tags = []; }
    if (table === 'password_resets' && r.used_at === undefined) r.used_at = null;
    return r;
  }

  function violates(table, row, ignoreRow) {
    for (const cols of UNIQUES[table] || []) {
      if (cols.some((c) => row[c] === undefined || row[c] === null)) continue;
      const dup = tables[table].find((o) => o !== ignoreRow && cols.every((c) => same(o[c], row[c])));
      if (dup) return { code: '23505', message: `duplicate key value violates unique constraint on ${table}(${cols.join(',')})` };
    }
    return null;
  }

  function project(table, row, cols) {
    if (!cols || cols.trim() === '*' || cols.trim() === '') return { ...row };
    const out = {};
    for (const raw of splitTop(cols)) {
      const c = raw.trim();
      const emb = c.match(/^(\w+)\(([^)]*)\)$/);
      if (emb) {
        const [, ft, fcols] = emb;
        const fk = `${ft.replace(/s$/, '')}_id`;
        const found = (tables[ft] || []).find((o) => same(o.id, row[fk]));
        out[ft] = found ? project(ft, found, fcols) : null;
      } else if (c === '*') Object.assign(out, row);
      else out[c] = row[c] === undefined ? null : row[c];
    }
    return out;
  }

  class Query {
    constructor(table) {
      this.table = table; this.op = 'select'; this.cols = '*'; this.opts = {};
      this.filters = []; this.sorts = []; this.max = null; this.from = null; this.to = null;
      this.payload = null; this.returning = false; this.singleMode = null; this.conflict = null; this.ignoreDup = false;
    }
    select(cols = '*', opts = {}) { if (this.op === 'select') { this.cols = cols; this.opts = opts; } else { this.returning = true; this.cols = cols; } return this; }
    insert(p) { this.op = 'insert'; this.payload = Array.isArray(p) ? p : [p]; return this; }
    upsert(p, o = {}) { this.op = 'upsert'; this.payload = Array.isArray(p) ? p : [p]; this.conflict = o.onConflict ? String(o.onConflict).split(',').map((s) => s.trim()) : null; this.ignoreDup = !!o.ignoreDuplicates; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push(makeFilter(c, 'eq', v)); return this; }
    neq(c, v) { this.filters.push(makeFilter(c, 'neq', v)); return this; }
    gt(c, v) { this.filters.push(makeFilter(c, 'gt', v)); return this; }
    gte(c, v) { this.filters.push(makeFilter(c, 'gte', v)); return this; }
    lt(c, v) { this.filters.push(makeFilter(c, 'lt', v)); return this; }
    lte(c, v) { this.filters.push(makeFilter(c, 'lte', v)); return this; }
    in(c, v) { this.filters.push(makeFilter(c, 'in', v)); return this; }
    is(c, v) { this.filters.push(makeFilter(c, 'is', v)); return this; }
    like(c, v) { this.filters.push(makeFilter(c, 'like', v)); return this; }
    ilike(c, v) { this.filters.push(makeFilter(c, 'ilike', v)); return this; }
    contains(c, v) { this.filters.push(makeFilter(c, 'contains', v)); return this; }
    overlaps(c, v) { this.filters.push(makeFilter(c, 'overlaps', v)); return this; }
    or(str) { this.filters.push(parseOr(str)); return this; }
    order(c, o = {}) { this.sorts.push([c, o.ascending !== false, o.nullsFirst]); return this; }
    limit(n) { this.max = n; return this; }
    range(a, b) { this.from = a; this.to = b; return this; }
    single() { this.singleMode = 'single'; return this; }
    maybeSingle() { this.singleMode = 'maybe'; return this; }

    run() {
      const t = this.table;
      if (missing.has(t) || !tables[t]) return { data: null, error: { code: '42P01', message: `relation "${t}" does not exist` }, count: null };
      const match = (r) => this.filters.every((f) => f(r));
      let rows;
      let count = null;

      if (this.op === 'select') {
        rows = tables[t].filter(match);
        count = rows.length;
        for (const [c, asc, nullsFirst] of [...this.sorts].reverse()) {
          rows = [...rows].sort((a, b) => {
            const an = a[c] === null || a[c] === undefined, bn = b[c] === null || b[c] === undefined;
            if (an || bn) { if (an && bn) return 0; const nf = nullsFirst === undefined ? !asc : nullsFirst; return an ? (nf ? -1 : 1) : (nf ? 1 : -1); }
            return asc ? cmp(a[c], b[c]) : cmp(b[c], a[c]);
          });
        }
        if (this.from !== null) rows = rows.slice(this.from, this.to + 1);
        if (this.max !== null) rows = rows.slice(0, this.max);
        rows = rows.map((r) => project(t, r, this.cols));
      } else if (this.op === 'insert' || this.op === 'upsert') {
        rows = [];
        for (const p of this.payload) {
          let row = applyDefaults(t, p);
          if (this.op === 'upsert') {
            const keys = this.conflict || CONFLICT_DEFAULT[t] || ['id'];
            const existing = tables[t].find((o) => keys.every((k) => same(o[k], row[k])));
            if (existing) {
              if (!this.ignoreDup) { Object.assign(existing, p); rows.push(existing); }
              continue;
            }
          }
          const err = violates(t, row);
          if (err) return { data: null, error: err, count: null };
          tables[t].push(row);
          rows.push(row);
        }
        rows = this.returning ? rows.map((r) => project(t, r, this.cols)) : null;
      } else if (this.op === 'update') {
        const targets = tables[t].filter(match);
        for (const r of targets) {
          const next = { ...r, ...this.payload };
          const err = violates(t, next, r);
          if (err) return { data: null, error: err, count: null };
        }
        targets.forEach((r) => Object.assign(r, this.payload));
        rows = this.returning ? targets.map((r) => project(t, r, this.cols)) : null;
      } else if (this.op === 'delete') {
        const targets = tables[t].filter(match);
        tables[t] = tables[t].filter((r) => !targets.includes(r));
        if (t === 'users') {
          const ids = targets.map((u) => u.id);
          for (const child of USER_CASCADE) tables[child] = tables[child].filter((r) => !ids.some((id) => same(r.user_id, id)));
          tables.reviews.forEach((r) => { if (ids.some((id) => same(r.user_id, id))) r.user_id = null; });
        }
        rows = this.returning ? targets.map((r) => project(t, r, this.cols)) : null;
      }

      if (this.singleMode) {
        const list = rows || [];
        if (list.length === 1) return { data: list[0], error: null, count };
        if (list.length === 0 && this.singleMode === 'maybe') return { data: null, error: null, count };
        return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count };
      }
      return { data: rows, error: null, count: this.opts && this.opts.count ? count : null };
    }

    then(resolve, reject) {
      try { return Promise.resolve(this.run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
    }
  }

  const client = {
    from: (table) => new Query(table),
    // ช่วยเทสต์
    __tables: tables,
    __dropTable: (name, drop = true) => (drop ? missing.add(name) : missing.delete(name))
  };
  return client;
}

// ใส่ Supabase จำลองแทน ./supabase (ต้องเรียกก่อน require ไฟล์อื่นของ Backend)
function installMemorySupabase(client = createMemorySupabase()) {
  const target = require.resolve('../../supabase');
  require.cache[target] = { id: target, filename: target, loaded: true, exports: client, children: [], paths: [] };
  return client;
}

module.exports = { createMemorySupabase, installMemorySupabase };
