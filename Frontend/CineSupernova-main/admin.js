// ============================================================================
// CineSupernova — Admin Dashboard
// token ของ admin เก็บใน sessionStorage (ปิดแท็บ = ออกจากระบบ) แยกจาก token ของผู้ใช้ทั่วไป
// ============================================================================
(function () {
  'use strict';

  const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `${window.location.protocol}//${window.location.host}`
    : 'https://cinesupernova.onrender.com';

  const TOKEN_KEY = 'cinesupernova_admin_token';
  const PAGE_SIZE = { movies: 24, users: 20, reviews: 20 };
  const POSTER_MAX_W = 600;
  const POSTER_MAX_H = 900;

  const $ = (id) => document.getElementById(id);
  let memoryToken = null;

  const state = {
    status: null,
    movies: { page: 1, search: '', poster: '', items: [], totalPages: 1 },
    users: { page: 1, search: '' },
    reviews: { page: 1, search: '' },
    uploadTarget: null, // id หนังที่กำลังจะอัปโหลดรูปจาก file picker (หรือ 'editor')
    editor: null // { movie, pendingImage, pendingUrl, removePending }
  };

  // ---------------------------------------------------------------------------
  // ตัวช่วยทั่วไป
  // ---------------------------------------------------------------------------
  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || memoryToken; } catch (e) { return memoryToken; }
  }
  function setToken(token) {
    memoryToken = token;
    try { if (token) sessionStorage.setItem(TOKEN_KEY, token); else sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function safeUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url, window.location.href);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  function fmtDate(value) {
    if (!value) return '–';
    try {
      return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return String(value);
    }
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString('th-TH');
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  async function api(path, { method = 'GET', body } = {}) {
    const token = getToken();
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      throw new Error('เชื่อมต่อ server ไม่ได้ (ถ้าใช้ Render แผนฟรี server อาจกำลังตื่น รอสักครู่แล้วลองใหม่)');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not json */ }
    if (res.status === 401 && path !== '/api/admin/login') {
      setToken(null);
      showLogin((data && data.error) || 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
      throw new Error((data && data.error) || 'Unauthorized');
    }
    if (!res.ok) throw new Error((data && data.error) || `เกิดข้อผิดพลาด (${res.status})`);
    return data;
  }

  function toast(message, type = 'success') {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `am-toast ${type}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 6000 : 3500);
  }

  function confirmDialog(text, { title = 'ยืนยัน', yes = 'ยืนยัน' } = {}) {
    return new Promise((resolve) => {
      const modal = $('confirmModal');
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text;
      $('confirmYes').textContent = yes;
      modal.classList.remove('hidden');
      $('confirmYes').focus();
      function done(answer) {
        modal.classList.add('hidden');
        $('confirmYes').removeEventListener('click', onYes);
        $('confirmNo').removeEventListener('click', onNo);
        modal.removeEventListener('click', onBackdrop);
        resolve(answer);
      }
      function onYes() { done(true); }
      function onNo() { done(false); }
      function onBackdrop(e) { if (e.target === modal) done(false); }
      $('confirmYes').addEventListener('click', onYes);
      $('confirmNo').addEventListener('click', onNo);
      modal.addEventListener('click', onBackdrop);
    });
  }

  function pagerHTML(page, totalPages, total, unit) {
    if (totalPages <= 1) return total ? `<span>ทั้งหมด ${fmtNum(total)} ${unit}</span>` : '';
    return `
      <button type="button" class="am-mini-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← ก่อนหน้า</button>
      <span>หน้า ${page} / ${totalPages} · ${fmtNum(total)} ${unit}</span>
      <button type="button" class="am-mini-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>ถัดไป →</button>`;
  }

  // ---------------------------------------------------------------------------
  // ย่อรูปฝั่ง browser ก่อนอัปโหลด (เร็วขึ้น ประหยัดพื้นที่ Storage)
  // ---------------------------------------------------------------------------
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('เปิดไฟล์รูปไม่ได้ (ไฟล์อาจเสีย หรือไม่ใช่รูป)'));
      img.src = src;
    });
  }

  async function fileToPosterDataUrl(file) {
    if (!file || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      throw new Error('รองรับเฉพาะไฟล์ JPG, PNG, WEBP หรือ GIF');
    }
    if (file.size > 20 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 20 MB');
    // GIF เก็บไว้ตามเดิม (จะได้ยังขยับได้) ถ้าไม่ใหญ่เกินไป
    if (/gif$/i.test(file.type) && file.size <= 4 * 1024 * 1024) return readAsDataUrl(file);

    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await loadImage(objectUrl);
      const scale = Math.min(1, POSTER_MAX_W / img.naturalWidth, POSTER_MAX_H / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      let out = canvas.toDataURL('image/webp', 0.86);
      if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.88);
      return out;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  // ---------------------------------------------------------------------------
  // เข้าสู่ระบบ / ออกจากระบบ
  // ---------------------------------------------------------------------------
  function showLogin(message) {
    $('adminApp').classList.add('hidden');
    $('adminLogin').classList.remove('hidden');
    $('adminLoginError').textContent = message || '';
    setTimeout(() => $('adminPass').focus(), 50);
  }

  async function showApp() {
    $('adminLogin').classList.add('hidden');
    $('adminApp').classList.remove('hidden');
    try {
      state.status = await api('/api/admin/status');
    } catch (e) {
      state.status = null;
    }
    $('autoPosterBtn').classList.toggle('hidden', !(state.status && state.status.tmdbEnabled));
    $('tmdbBox').classList.toggle('hidden', !(state.status && state.status.tmdbEnabled));
    route();
  }

  $('adminLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    $('adminLoginError').textContent = '';
    btn.disabled = true;
    try {
      const res = await api('/api/admin/login', {
        method: 'POST',
        body: { username: $('adminUser').value, password: $('adminPass').value }
      });
      setToken(res.token);
      $('adminPass').value = '';
      await showApp();
    } catch (err) {
      $('adminLoginError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('adminLogoutBtn').addEventListener('click', () => {
    setToken(null);
    showLogin('ออกจากระบบแล้ว');
  });

  // ---------------------------------------------------------------------------
  // แท็บ (ใช้ #hash ใน URL รีเฟรชแล้วอยู่แท็บเดิม)
  // ---------------------------------------------------------------------------
  const TABS = ['overview', 'movies', 'users', 'reviews', 'system'];

  function route() {
    if (!getToken()) return;
    const tab = TABS.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'overview';
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab));
    document.querySelectorAll('.am-tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    const loaders = { overview: loadOverview, movies: loadMovies, users: loadUsers, reviews: loadReviews, system: loadSystem };
    loaders[tab]().catch((err) => toast(err.message, 'error'));
  }
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------------------
  // ภาพรวม
  // ---------------------------------------------------------------------------
  async function loadOverview() {
    const s = await api('/api/admin/stats');
    const pct = s.movies ? Math.round((s.moviesWithPoster / s.movies) * 100) : 0;
    $('overviewHello').textContent = `อัปเดตล่าสุด ${fmtDate(new Date())}`;
    $('statCards').innerHTML = [
      ['🎬 หนังทั้งหมด', s.movies, ''],
      ['🖼️ ยังไม่มีรูป', s.moviesWithoutPoster, s.moviesWithoutPoster ? 'warn' : 'good'],
      ['👥 ผู้ใช้', s.users, ''],
      ['💬 รีวิว', s.reviews, ''],
      ['📌 รายการใน Watchlist', s.watchlistItems, '']
    ].map(([lbl, num, cls]) => `<div class="am-stat ${cls}"><span class="lbl">${lbl}</span><span class="num">${fmtNum(num)}</span></div>`).join('');

    $('posterProgress').innerHTML = `
      <div class="am-grow">
        <strong>รูปโปสเตอร์: มีแล้ว ${fmtNum(s.moviesWithPoster)} จาก ${fmtNum(s.movies)} เรื่อง (${pct}%)</strong>
        <div class="am-bar"><span style="width:${pct}%"></span></div>
      </div>
      ${s.moviesWithoutPoster ? '<a href="#movies" class="btn btn-primary btn-sm" id="gotoMissing">🖼️ เพิ่มรูปให้หนังที่ยังไม่มี</a>' : '<span class="am-sub">🎉 หนังทุกเรื่องมีรูปแล้ว</span>'}`;
    const goto = $('gotoMissing');
    if (goto) goto.addEventListener('click', () => { state.movies.poster = 'missing'; state.movies.page = 1; $('moviePosterFilter').value = 'missing'; });

    $('recentReviews').innerHTML = s.recentReviews.length ? s.recentReviews.map((r) => `
      <div class="am-mini-item">
        <div class="top"><span>${esc(r.author)} → ${esc(r.movieTitle || `#${r.movieId}`)} · 🍿${esc(r.rating)}</span><span>${fmtDate(r.createdAt)}</span></div>
        <div class="txt">${esc(r.text) || '<em>(ไม่มีข้อความ)</em>'}</div>
      </div>`).join('') : '<div class="am-empty">ยังไม่มีรีวิว</div>';

    $('recentUsers').innerHTML = s.recentUsers.length ? s.recentUsers.map((u) => `
      <div class="am-mini-item">
        <div class="top"><span>${esc(u.username)}</span><span>${fmtDate(u.createdAt)}</span></div>
        <div class="txt">${esc(u.email)}</div>
      </div>`).join('') : '<div class="am-empty">ยังไม่มีสมาชิก</div>';
  }

  // ---------------------------------------------------------------------------
  // หนัง & รูป
  // ---------------------------------------------------------------------------
  function posterInnerHTML(movie, { badge = true } = {}) {
    const src = safeUrl(movie && movie.posterUrl);
    if (src) return `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.classList.add('img-broken')">`;
    return `${badge ? '<span class="am-badge-missing">ยังไม่มีรูป</span>' : ''}
      <div class="am-poster-empty"><span class="am-poster-icon">${esc((movie && movie.icon) || '🎬')}</span><span>คลิกหรือลากรูปมาวาง</span></div>`;
  }

  function movieCardHTML(m) {
    const has = Boolean(safeUrl(m.posterUrl));
    return `
      <article class="am-movie" data-id="${Number(m.id)}">
        <div class="am-poster ${esc(m.posterClass || 'poster-drama')}${has ? ' has-img' : ''}" data-act="upload" tabindex="0" role="button" aria-label="อัปโหลดรูปโปสเตอร์ ${esc(m.title)}">
          ${posterInnerHTML(m)}
          <div class="am-drop-hint">${has ? '🔄 เปลี่ยนรูป' : '⬆️ อัปโหลดรูป'}<br>(คลิก หรือ ลากไฟล์มาวาง)</div>
        </div>
        <div class="am-movie-info">
          <h3 title="${esc(m.title)}">${esc(m.title)}</h3>
          <div class="meta">#${Number(m.id)} · ${esc(m.genre || '–')} · ${esc(m.year || '–')}</div>
        </div>
        <div class="am-movie-actions">
          <button type="button" data-act="upload">🖼️ ${has ? 'เปลี่ยนรูป' : 'ใส่รูป'}</button>
          <button type="button" data-act="edit">✏️ แก้ไข</button>
        </div>
      </article>`;
  }

  async function loadMovies() {
    const s = state.movies;
    const q = new URLSearchParams({ page: s.page, limit: PAGE_SIZE.movies });
    if (s.search) q.set('search', s.search);
    if (s.poster) q.set('poster', s.poster);
    $('movieGrid').innerHTML = '<div class="am-empty">กำลังโหลด...</div>';
    const data = await api(`/api/admin/movies?${q}`);
    s.items = data.items;
    s.totalPages = data.totalPages;
    const label = { '': 'ทุกเรื่อง', missing: 'ยังไม่มีรูป', has: 'มีรูปแล้ว' }[s.poster || ''];
    $('movieSummary').textContent = `${label}${s.search ? ` · ค้นหา "${s.search}"` : ''} — พบ ${fmtNum(data.total)} เรื่อง`;
    $('movieGrid').innerHTML = data.items.length
      ? data.items.map(movieCardHTML).join('')
      : '<div class="am-empty">ไม่พบหนังตามเงื่อนไขนี้</div>';
    $('moviePager').innerHTML = pagerHTML(data.page, data.totalPages, data.total, 'เรื่อง');
  }

  function replaceMovieCard(movie) {
    const idx = state.movies.items.findIndex((m) => m.id === movie.id);
    if (idx >= 0) state.movies.items[idx] = movie;
    const old = document.querySelector(`.am-movie[data-id="${Number(movie.id)}"]`);
    if (old) old.outerHTML = movieCardHTML(movie);
  }

  async function uploadPosterFor(movieId, file) {
    const card = document.querySelector(`.am-movie[data-id="${Number(movieId)}"] .am-poster`);
    if (card) card.classList.add('busy');
    try {
      const image = await fileToPosterDataUrl(file);
      const res = await api(`/api/admin/movies/${movieId}/poster`, { method: 'POST', body: { image } });
      replaceMovieCard(res.movie);
      toast(`อัปโหลดรูป "${res.movie.title}" แล้ว${res.bytes ? ` (${Math.round(res.bytes / 1024)} KB)` : ''}`);
      return res.movie;
    } catch (err) {
      toast(err.message, 'error');
      throw err;
    } finally {
      const again = document.querySelector(`.am-movie[data-id="${Number(movieId)}"] .am-poster`);
      if (again) again.classList.remove('busy');
    }
  }

  // คลิกในตารางหนัง
  $('movieGrid').addEventListener('click', (e) => {
    const target = e.target.closest('[data-act]');
    const card = e.target.closest('.am-movie');
    if (!target || !card) return;
    const id = Number(card.dataset.id);
    if (target.dataset.act === 'upload') {
      state.uploadTarget = id;
      $('posterFileInput').value = '';
      $('posterFileInput').click();
    } else if (target.dataset.act === 'edit') {
      const movie = state.movies.items.find((m) => m.id === id);
      openEditor(movie);
    }
  });
  $('movieGrid').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('am-poster')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // ลากไฟล์มาวางบนการ์ด
  $('movieGrid').addEventListener('dragover', (e) => {
    const card = e.target.closest('.am-movie');
    if (!card) return;
    e.preventDefault();
    card.classList.add('drag-over');
  });
  $('movieGrid').addEventListener('dragleave', (e) => {
    const card = e.target.closest('.am-movie');
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('drag-over');
  });
  $('movieGrid').addEventListener('drop', (e) => {
    const card = e.target.closest('.am-movie');
    if (!card) return;
    e.preventDefault();
    card.classList.remove('drag-over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uploadPosterFor(Number(card.dataset.id), file).catch(() => {});
  });
  // กันเผลอวางไฟล์นอกการ์ดแล้ว browser เปิดไฟล์แทนหน้าเว็บ
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('posterFileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (state.uploadTarget === 'editor') editorUseFile(file);
    else if (state.uploadTarget) uploadPosterFor(state.uploadTarget, file).catch(() => {});
    state.uploadTarget = null;
  });

  $('movieSearch').addEventListener('input', debounce((e) => {
    state.movies.search = e.target.value.trim();
    state.movies.page = 1;
    loadMovies().catch((err) => toast(err.message, 'error'));
  }, 350));
  $('moviePosterFilter').addEventListener('change', (e) => {
    state.movies.poster = e.target.value;
    state.movies.page = 1;
    loadMovies().catch((err) => toast(err.message, 'error'));
  });
  $('moviePager').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    state.movies.page = Number(btn.dataset.page);
    loadMovies().then(() => window.scrollTo({ top: 0, behavior: 'smooth' })).catch((err) => toast(err.message, 'error'));
  });

  $('newMovieBtn').addEventListener('click', () => openEditor(null));

  $('autoPosterBtn').addEventListener('click', async () => {
    const ok = await confirmDialog('ระบบจะค้นหาโปสเตอร์จาก TMDB ให้หนังที่ยังไม่มีรูป ครั้งละไม่เกิน 25 เรื่อง (เลือกผลลัพธ์แรกที่เจอ) ตรวจทานภายหลังได้เสมอ', { title: 'เติมรูปอัตโนมัติ', yes: 'เริ่มเลย' });
    if (!ok) return;
    const btn = $('autoPosterBtn');
    btn.disabled = true;
    btn.textContent = '⏳ กำลังค้นหา...';
    try {
      const res = await api('/api/admin/posters/auto', { method: 'POST', body: { limit: 25 } });
      toast(`เติมรูปสำเร็จ ${res.filled.length} เรื่อง${res.notFound.length ? ` · หาไม่เจอ ${res.notFound.length} เรื่อง` : ''}`, res.filled.length ? 'success' : 'info');
      await loadMovies();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ เติมรูปอัตโนมัติ (TMDB)';
    }
  });

  // ---------------------------------------------------------------------------
  // หน้าต่างแก้ไข / เพิ่มหนัง
  // ---------------------------------------------------------------------------
  const FIELDS = ['title', 'genre', 'year', 'score', 'runtime', 'mpaaRating', 'votes', 'director', 'star', 'writer', 'country', 'company', 'icon', 'budget', 'gross', 'posterClass', 'tags', 'synopsis'];
  const NUMERIC = new Set(['year', 'score', 'runtime', 'votes', 'budget', 'gross']);

  function renderEditorPoster() {
    const ed = state.editor;
    const box = $('editorPoster');
    let src = '';
    if (ed.pendingImage) src = ed.pendingImage;
    else if (ed.pendingUrl) src = ed.pendingUrl;
    else if (!ed.removePending && ed.movie) src = safeUrl(ed.movie.posterUrl);
    const posterClass = $('movieForm').elements.posterClass.value || 'poster-drama';
    box.className = `am-poster am-poster-lg ${posterClass}${src ? ' has-img' : ''}`;
    box.innerHTML = `${src ? `<img src="${esc(src)}" alt="">` : posterInnerHTML({ icon: $('movieForm').elements.icon.value || '🎬' }, { badge: false })}
      <div class="am-drop-hint">${src ? '🔄 เปลี่ยนรูป' : '⬆️ อัปโหลดรูป'}</div>`;
    $('editorRemovePosterBtn').disabled = !src;
  }

  function openEditor(movie) {
    state.editor = { movie, pendingImage: null, pendingUrl: null, removePending: false };
    const form = $('movieForm');
    form.reset();
    FIELDS.forEach((f) => {
      const el = form.elements[f];
      if (!el) return;
      let v = movie ? movie[f] : '';
      if (f === 'tags') v = (movie && movie.tags || []).join(', ');
      if (f === 'posterClass') v = (movie && movie.posterClass) || 'poster-drama';
      el.value = v === null || v === undefined ? '' : v;
    });
    $('movieModalTitle').textContent = movie ? `แก้ไข: ${movie.title} (#${movie.id})` : 'เพิ่มหนังใหม่';
    $('movieDeleteBtn').classList.toggle('hidden', !movie);
    $('movieFormError').textContent = '';
    $('editorPosterUrl').value = '';
    $('tmdbResults').innerHTML = '';
    renderEditorPoster();
    $('movieModal').classList.remove('hidden');
    setTimeout(() => form.elements.title.focus(), 50);
  }

  function closeEditor() {
    $('movieModal').classList.add('hidden');
    state.editor = null;
  }

  async function editorUseFile(file) {
    const ed = state.editor;
    if (!ed) return;
    const box = $('editorPoster');
    box.classList.add('busy');
    try {
      if (ed.movie) {
        const updated = await uploadPosterFor(ed.movie.id, file);
        ed.movie = updated;
        ed.removePending = false;
      } else {
        ed.pendingImage = await fileToPosterDataUrl(file);
        ed.pendingUrl = null;
        toast('เลือกรูปแล้ว — จะอัปโหลดตอนกดบันทึก', 'info');
      }
    } catch (err) {
      // uploadPosterFor แจ้ง error ไปแล้ว
      if (!ed.movie) toast(err.message, 'error');
    } finally {
      box.classList.remove('busy');
      if (state.editor) renderEditorPoster();
    }
  }

  async function editorUseUrl(url) {
    const ed = state.editor;
    if (!ed) return;
    const clean = safeUrl(url);
    if (!clean) { toast('ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://', 'error'); return; }
    if (ed.movie) {
      $('editorPoster').classList.add('busy');
      try {
        const res = await api(`/api/admin/movies/${ed.movie.id}/poster`, { method: 'POST', body: { url: clean } });
        ed.movie = res.movie;
        replaceMovieCard(res.movie);
        toast('ตั้งรูปจากลิงก์แล้ว');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        $('editorPoster').classList.remove('busy');
      }
    } else {
      ed.pendingUrl = clean;
      ed.pendingImage = null;
    }
    renderEditorPoster();
  }

  $('editorPoster').addEventListener('click', () => {
    state.uploadTarget = 'editor';
    $('posterFileInput').value = '';
    $('posterFileInput').click();
  });
  $('editorPoster').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('editorPoster').click(); }
  });
  $('editorPickBtn').addEventListener('click', () => $('editorPoster').click());
  $('editorPoster').addEventListener('dragover', (e) => { e.preventDefault(); $('editorPoster').classList.add('drag-over'); });
  $('editorPoster').addEventListener('dragleave', () => $('editorPoster').classList.remove('drag-over'));
  $('editorPoster').addEventListener('drop', (e) => {
    e.preventDefault();
    $('editorPoster').classList.remove('drag-over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) editorUseFile(file);
  });
  $('editorUseUrlBtn').addEventListener('click', () => editorUseUrl($('editorPosterUrl').value.trim()));
  $('editorPosterUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editorUseUrl(e.target.value.trim()); }
  });
  $('movieForm').elements.posterClass.addEventListener('change', renderEditorPoster);
  $('movieForm').elements.icon.addEventListener('input', renderEditorPoster);

  // วางรูปจาก clipboard (Ctrl+V) ตอนเปิดหน้าต่างแก้ไขอยู่
  document.addEventListener('paste', (e) => {
    if (!state.editor || $('movieModal').classList.contains('hidden')) return;
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const imageItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      editorUseFile(imageItem.getAsFile());
    }
  });

  $('editorRemovePosterBtn').addEventListener('click', async () => {
    const ed = state.editor;
    if (!ed) return;
    if (ed.pendingImage || ed.pendingUrl) {
      ed.pendingImage = null;
      ed.pendingUrl = null;
      renderEditorPoster();
      return;
    }
    if (!ed.movie || !ed.movie.posterUrl) return;
    const ok = await confirmDialog(`ลบรูปโปสเตอร์ของ "${ed.movie.title}" ใช่ไหม? (การ์ดจะกลับไปใช้สีตามแนวหนัง)`, { title: 'ลบรูป', yes: 'ลบรูป' });
    if (!ok) return;
    try {
      const updated = await api(`/api/admin/movies/${ed.movie.id}/poster`, { method: 'DELETE' });
      ed.movie = updated;
      replaceMovieCard(updated);
      toast('ลบรูปแล้ว');
      renderEditorPoster();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('tmdbSearchBtn').addEventListener('click', async () => {
    const ed = state.editor;
    const results = $('tmdbResults');
    if (!ed) return;
    if (!ed.movie) { toast('บันทึกหนังก่อน แล้วค่อยค้นหาจาก TMDB', 'info'); return; }
    const title = $('movieForm').elements.title.value.trim();
    const year = $('movieForm').elements.year.value.trim();
    results.innerHTML = '<div class="am-empty" style="grid-column:1/-1;">กำลังค้นหา...</div>';
    try {
      const q = new URLSearchParams({ query: title });
      if (year) q.set('year', year);
      const data = await api(`/api/admin/movies/${ed.movie.id}/tmdb?${q}`);
      results.innerHTML = data.items.length ? data.items.map((it) => `
        <button type="button" class="am-tmdb-pick" data-url="${esc(it.posterUrl)}" title="${esc(it.title)} (${esc(it.year)})">
          <img src="${esc(it.thumbUrl)}" alt="${esc(it.title)}" loading="lazy"><span>${esc(it.title)} ${esc(it.year)}</span>
        </button>`).join('') : '<div class="am-empty" style="grid-column:1/-1;">ไม่พบโปสเตอร์ ลองแก้ชื่อเรื่องให้เป็นภาษาอังกฤษแล้วค้นหาใหม่</div>';
    } catch (err) {
      results.innerHTML = '';
      toast(err.message, 'error');
    }
  });
  $('tmdbResults').addEventListener('click', (e) => {
    const pick = e.target.closest('.am-tmdb-pick');
    if (pick) editorUseUrl(pick.dataset.url);
  });

  function collectForm() {
    const form = $('movieForm');
    const out = {};
    FIELDS.forEach((f) => {
      const el = form.elements[f];
      if (!el) return;
      const raw = el.value.trim();
      if (NUMERIC.has(f)) out[f] = raw === '' ? null : Number(raw);
      else if (f === 'tags') out[f] = raw ? raw.split(',').map((t) => t.trim()).filter(Boolean) : [];
      else out[f] = raw === '' ? null : raw;
    });
    return out;
  }

  $('movieSaveBtn').addEventListener('click', async () => {
    const ed = state.editor;
    if (!ed) return;
    const payload = collectForm();
    if (!payload.title) {
      $('movieFormError').textContent = 'ต้องใส่ชื่อเรื่อง';
      $('movieForm').elements.title.focus();
      return;
    }
    if (!payload.icon) delete payload.icon;
    const btn = $('movieSaveBtn');
    btn.disabled = true;
    $('movieFormError').textContent = '';
    try {
      let movie;
      if (ed.movie) {
        movie = await api(`/api/admin/movies/${ed.movie.id}`, { method: 'PUT', body: payload });
        toast(`บันทึก "${movie.title}" แล้ว`);
      } else {
        movie = await api('/api/admin/movies', { method: 'POST', body: payload });
        if (ed.pendingImage || ed.pendingUrl) {
          const body = ed.pendingImage ? { image: ed.pendingImage } : { url: ed.pendingUrl };
          try {
            movie = (await api(`/api/admin/movies/${movie.id}/poster`, { method: 'POST', body })).movie;
          } catch (err) {
            toast(`เพิ่มหนังแล้ว แต่อัปโหลดรูปไม่สำเร็จ: ${err.message}`, 'error');
          }
        }
        toast(`เพิ่มหนัง "${movie.title}" (#${movie.id}) แล้ว`);
      }
      closeEditor();
      await loadMovies();
    } catch (err) {
      $('movieFormError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('movieDeleteBtn').addEventListener('click', async () => {
    const ed = state.editor;
    if (!ed || !ed.movie) return;
    const ok = await confirmDialog(`ลบ "${ed.movie.title}" ถาวร? รีวิวและ Watchlist ของหนังเรื่องนี้จะถูกลบไปด้วย`, { title: 'ลบหนัง', yes: 'ลบถาวร' });
    if (!ok) return;
    try {
      const res = await api(`/api/admin/movies/${ed.movie.id}`, { method: 'DELETE' });
      toast(res.message);
      closeEditor();
      await loadMovies();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('movieModal').addEventListener('click', (e) => {
    if (e.target === $('movieModal') || e.target.closest('[data-close]')) closeEditor();
  });

  // ---------------------------------------------------------------------------
  // ผู้ใช้
  // ---------------------------------------------------------------------------
  async function loadUsers() {
    const s = state.users;
    const q = new URLSearchParams({ page: s.page, limit: PAGE_SIZE.users });
    if (s.search) q.set('search', s.search);
    const data = await api(`/api/admin/users?${q}`);
    $('userRows').innerHTML = data.items.length ? data.items.map((u) => `
      <tr data-id="${Number(u.id)}" data-name="${esc(u.username)}">
        <td>${Number(u.id)}</td>
        <td class="name">${esc(u.username)}</td>
        <td>${esc(u.email)}</td>
        <td>${fmtNum(u.reviewCount)}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td><div class="am-row-actions">
          <button type="button" class="am-mini-btn" data-act="reset">📧 ส่งลิงก์รีเซ็ตรหัส</button>
          <button type="button" class="am-mini-btn" data-act="logout">🚪 เตะออกจากระบบ</button>
          <button type="button" class="am-mini-btn danger" data-act="delete">🗑 ลบ</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="6" class="am-empty">ไม่พบผู้ใช้</td></tr>';
    $('userPager').innerHTML = pagerHTML(data.page, data.totalPages, data.total, 'คน');
  }

  $('userRows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('tr[data-id]');
    if (!btn || !row) return;
    const id = row.dataset.id;
    const name = row.dataset.name;
    const act = btn.dataset.act;
    const texts = {
      reset: [`ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลของ ${name}?`, 'ส่งลิงก์รีเซ็ต', 'ส่งเลย'],
      logout: [`บังคับให้ ${name} ออกจากระบบทุกอุปกรณ์?`, 'เตะออกจากระบบ', 'ยืนยัน'],
      delete: [`ลบบัญชี ${name} ถาวร? Watchlist และประวัติของผู้ใช้จะถูกลบ (รีวิวจะยังอยู่แต่ไม่ผูกกับบัญชี)`, 'ลบผู้ใช้', 'ลบถาวร']
    }[act];
    const ok = await confirmDialog(texts[0], { title: texts[1], yes: texts[2] });
    if (!ok) return;
    btn.disabled = true;
    try {
      const path = act === 'delete' ? `/api/admin/users/${id}` : `/api/admin/users/${id}/${act === 'reset' ? 'send-reset' : 'logout'}`;
      const res = await api(path, { method: act === 'delete' ? 'DELETE' : 'POST' });
      toast(res.message, res.delivered === false ? 'info' : 'success');
      if (act === 'delete') await loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  $('userSearch').addEventListener('input', debounce((e) => {
    state.users.search = e.target.value.trim();
    state.users.page = 1;
    loadUsers().catch((err) => toast(err.message, 'error'));
  }, 350));
  $('userPager').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    state.users.page = Number(btn.dataset.page);
    loadUsers().catch((err) => toast(err.message, 'error'));
  });

  // ---------------------------------------------------------------------------
  // รีวิว
  // ---------------------------------------------------------------------------
  async function loadReviews() {
    const s = state.reviews;
    const q = new URLSearchParams({ page: s.page, limit: PAGE_SIZE.reviews });
    if (s.search) q.set('search', s.search);
    const data = await api(`/api/admin/reviews?${q}`);
    $('reviewList').innerHTML = data.items.length ? data.items.map((r) => `
      <div class="am-review" data-id="${Number(r.id)}">
        <div class="body">
          <div class="who">
            <span>🧑‍🚀 ${esc(r.author)}${r.userId ? '' : ' <span class="am-tag">guest</span>'}</span>
            <span>→ <a class="movie" href="detail.html?id=${Number(r.movieId)}" target="_blank" rel="noopener">${esc(r.movieTitle || `หนัง #${r.movieId}`)}</a></span>
            <span>🍿 ${esc(r.rating)}</span>
            ${r.spoiler ? '<span class="am-tag">สปอยล์</span>' : ''}
            <span style="color:var(--text-dim);font-weight:500;">${fmtDate(r.createdAt)}</span>
          </div>
          <p class="text">${esc(r.text) || '<em>(ไม่มีข้อความ)</em>'}</p>
        </div>
        <button type="button" class="am-mini-btn danger" data-act="delete">🗑 ลบ</button>
      </div>`).join('') : '<div class="am-empty">ไม่พบรีวิว</div>';
    $('reviewPager').innerHTML = pagerHTML(data.page, data.totalPages, data.total, 'รีวิว');
  }

  $('reviewList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="delete"]');
    const item = e.target.closest('.am-review');
    if (!btn || !item) return;
    const ok = await confirmDialog('ลบรีวิวนี้ถาวร?', { title: 'ลบรีวิว', yes: 'ลบ' });
    if (!ok) return;
    try {
      await api(`/api/admin/reviews/${item.dataset.id}`, { method: 'DELETE' });
      item.remove();
      toast('ลบรีวิวแล้ว');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('reviewSearch').addEventListener('input', debounce((e) => {
    state.reviews.search = e.target.value.trim();
    state.reviews.page = 1;
    loadReviews().catch((err) => toast(err.message, 'error'));
  }, 350));
  $('reviewPager').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    state.reviews.page = Number(btn.dataset.page);
    loadReviews().catch((err) => toast(err.message, 'error'));
  });

  // ---------------------------------------------------------------------------
  // ตั้งค่าระบบ (เช็ค Environment + ฐานข้อมูล)
  // ---------------------------------------------------------------------------
  function check(ok, title, detail, level) {
    const icon = ok ? '✅' : (level === 'optional' ? '➖' : (level === 'warn' ? '⚠️' : '❌'));
    return `<div class="am-check"><span class="ic">${icon}</span><div><div class="t">${title}</div><div class="d">${detail}</div></div></div>`;
  }

  async function loadSystem() {
    $('systemChecks').innerHTML = '<div class="am-empty">กำลังตรวจ...</div>';
    const s = await api('/api/admin/status');
    state.status = s;
    const db = s.database || {};
    const mailText = {
      'gmail-script': 'ส่งผ่าน <strong>Gmail (Google Apps Script)</strong>' + (s.gmailScriptSecretSet ? '' : ' — ⚠️ ยังไม่ได้ตั้ง <code>GMAIL_SCRIPT_SECRET</code>'),
      brevo: `ส่งผ่าน <strong>Brevo</strong> จาก <code>${esc(s.mailFrom || '')}</code>`,
      resend: 'ส่งผ่าน <strong>Resend</strong> (ถ้ายังไม่ยืนยันโดเมน จะส่งได้เฉพาะอีเมลเจ้าของบัญชี Resend)',
      none: 'ยังไม่ได้ตั้งค่า — ลิงก์รีเซ็ตรหัสผ่านจะถูกพิมพ์ไว้ใน Logs ของ server แทน ผู้ใช้จะไม่ได้รับเมล (ตั้ง <code>GMAIL_SCRIPT_URL</code> + <code>GMAIL_SCRIPT_SECRET</code> หรือ <code>BREVO_API_KEY</code> + <code>MAIL_FROM_EMAIL</code>)'
    }[s.mailProvider] || esc(s.mailProvider);
    const appUrlIsLocal = /localhost|127\.0\.0\.1/.test(s.appUrl);
    $('systemChecks').innerHTML = [
      check(s.admin.ready, 'รหัส Admin (ADMIN_USERNAME / ADMIN_PASSWORD)', s.admin.ready ? `ใช้งานได้ · ชื่อผู้ใช้ admin: <code>${esc(s.admin.username)}</code>` : esc(s.admin.reason)),
      check(s.jwtSecretSet, 'JWT_SECRET', s.jwtSecretSet ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้ง — ระบบใช้ค่าเริ่มต้นที่อยู่ในโค้ด (ใครเห็นโค้ดใน GitHub ก็รู้) ควรตั้งเป็นค่าสุ่มยาวๆ', 'warn'),
      check(db.posterColumn, 'คอลัมน์ movies.poster_url', db.posterColumn ? 'พร้อมใช้งาน' : 'ยังไม่มี — รัน <code>Backend/sql/migration_admin_reset.sql</code> ใน Supabase SQL Editor'),
      check(db.passwordResetsTable, 'ตาราง password_resets (ระบบลืมรหัสผ่าน)', db.passwordResetsTable ? 'พร้อมใช้งาน' : 'ยังไม่มี — รัน <code>Backend/sql/migration_admin_reset.sql</code> ใน Supabase SQL Editor'),
      check(s.storage && s.storage.ok, `Supabase Storage bucket "${esc(s.posterBucket)}"`, s.storage && s.storage.ok ? 'พร้อมเก็บไฟล์รูป' : esc((s.storage && s.storage.error) || 'ใช้งานไม่ได้')),
      check(!appUrlIsLocal, 'ลิงก์หน้าเว็บในอีเมล (APP_URL)', `<code>${esc(s.appUrl)}</code> (มาจาก ${esc(s.appUrlSource)})${appUrlIsLocal ? ' — ลิงก์ในอีเมลจะชี้ไป localhost ให้ตั้ง APP_URL เป็น URL เว็บจริง' : ''}`, 'warn'),
      check(s.mailProvider !== 'none', 'ระบบส่งอีเมล', mailText, 'warn'),
      ...(s.resetDemoMode ? [check(false, 'PASSWORD_RESET_DEMO = true', 'โหมดสาธิตเปิดอยู่ — หน้าเว็บจะโชว์ลิงก์รีเซ็ตให้ใครก็ได้กด ควรตั้งเป็น <code>false</code> บนเว็บจริง')] : []),
      check(s.tmdbEnabled, 'TMDB (ค้นหาโปสเตอร์อัตโนมัติ) — ไม่บังคับ', s.tmdbEnabled ? 'เปิดใช้งาน' : 'ปิดอยู่ — ตั้ง <code>TMDB_API_KEY</code> ถ้าอยากให้ค้นหา/เติมรูปอัตโนมัติ', 'optional')
    ].join('');
    $('autoPosterBtn').classList.toggle('hidden', !s.tmdbEnabled);
    $('tmdbBox').classList.toggle('hidden', !s.tmdbEnabled);
  }

  $('refreshStatusBtn').addEventListener('click', () => loadSystem().catch((err) => toast(err.message, 'error')));

  $('testEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const out = $('testEmailResult');
    btn.disabled = true;
    out.style.color = '';
    out.textContent = 'กำลังส่ง...';
    try {
      const res = await api('/api/admin/test-email', { method: 'POST', body: { to: $('testEmailTo').value.trim() } });
      out.style.color = res.delivered === false ? 'var(--butter)' : 'var(--mint)';
      out.textContent = res.message;
    } catch (err) {
      out.style.color = '#ff6b6b';
      out.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------------------
  // ปุ่ม Esc ปิดหน้าต่าง
  // ---------------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('confirmModal').classList.contains('hidden')) $('confirmNo').click();
    else if (!$('movieModal').classList.contains('hidden')) closeEditor();
  });

  // ---------------------------------------------------------------------------
  // เริ่มต้น
  // ---------------------------------------------------------------------------
  (async function init() {
    if (!getToken()) {
      showLogin();
      return;
    }
    try {
      await api('/api/admin/me');
      await showApp();
    } catch (e) {
      if (!$('adminLogin').classList.contains('hidden')) return;
      showLogin(e.message);
    }
  })();
})();
