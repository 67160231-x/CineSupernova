// --- Auth Guard Check (ดักผู้ใช้ที่ยังไม่ได้ล็อกอิน) ---
(function checkAuth() {
  const token = localStorage.getItem('token');
  let currentPage = window.location.pathname.split('/').pop().toLowerCase();
  
  // รองรับกรณีเข้าผ่าน Root Path ('/')
  if (!currentPage) currentPage = 'index.html';

  const publicPages = ['login.html', 'reset-password.html'];
  // มาจากปุ่ม "ไม่ใช่ฉัน" ในอีเมลแจ้งเปลี่ยนรหัส (login.html?forgot=1) — ต้องเปิดฟอร์มลืมรหัสผ่านได้แม้มี token ค้างอยู่
  const wantsForgot = new URLSearchParams(window.location.search).has('forgot');

  if (!token && !publicPages.includes(currentPage)) {
    window.location.href = 'login.html';
  }
  if (token && currentPage === 'login.html' && !wantsForgot) {
    window.location.href = 'index.html';
  }
})();

// 🔥 แก้ไขจุดนี้: ถ้ารันบนเครื่องตัวเอง (localhost) ให้ใช้ port 3000 แต่ถ้าบน Vercel ให้ยิงไปที่ Render
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : 'https://cinesupernova.onrender.com';

const MOVIES = [];
// หมายเหตุ: ตอนนี้ backend คำนวณ posterClass/icon ให้แต่ละหนังไว้แล้วตั้งแต่ตอนนำเข้าข้อมูล
// (ดู Backend/sql/seed_movies.sql) เก็บ mapping นี้ไว้เป็นแค่ fallback เผื่อหนังเรื่องไหนไม่มีค่ามาจาก API
const GENRE_ART = [
  { match: 'Sci-Fi', cls: 'poster-scifi', icon: '🛸' },
  { match: 'Horror', cls: 'poster-horror', icon: '👻' },
  { match: 'Thriller', cls: 'poster-horror', icon: '😱' },
  { match: 'Mystery', cls: 'poster-crime', icon: '🔍' },
  { match: 'Crime', cls: 'poster-crime', icon: '🕵️' },
  { match: 'Romance', cls: 'poster-romance', icon: '💗' },
  { match: 'Comedy', cls: 'poster-comedy', icon: '😂' },
  { match: 'Music', cls: 'poster-comedy', icon: '🎵' },
  { match: 'Action', cls: 'poster-action', icon: '💥' },
  { match: 'Western', cls: 'poster-action', icon: '🤠' },
  { match: 'Adventure', cls: 'poster-adventure', icon: '🗺️' },
  { match: 'Fantasy', cls: 'poster-fantasy', icon: '🧙' },
  { match: 'Animation', cls: 'poster-animation', icon: '🎨' },
  { match: 'Family', cls: 'poster-animation', icon: '👨‍👩‍👧' },
  { match: 'Drama', cls: 'poster-drama', icon: '🎭' },
  { match: 'Biography', cls: 'poster-drama', icon: '🎬' },
  { match: 'History', cls: 'poster-drama', icon: '📜' }
];
const MOOD_META = {
  1: 'หดหู่ อยากร้องไห้กับหนังสักเรื่อง 🎞️',
  2: 'เหนื่อยๆ อยากดูอะไรเบาสมอง ☁️',
  3: 'เฉยๆ อยากดูอะไรก็ได้ ลองดูหนังที่เราเลือกให้เลย 👇',
  4: 'อารมณ์ดี อยากดูอะไรสนุกๆ 🎉',
  5: 'พลังล้น อยากได้อะไรมันส์จัดเต็ม 🚀'
};
const REVIEW_TEMPLATES = {
  hype: 'ป้ายยาเรื่องนี้แรงมาก! ดูจบแล้วอยากลากเพื่อนทั้งกลุ่มไปดูรอบสองทันที บทดี ภาพสวย อารมณ์จัดเต็มทุกนาที',
  'polite-roast': 'ต้องขออนุญาตติงนิดหน่อยนะคะ บทช่วงกลางเรื่องยืดไปสักหน่อย แต่โดยรวมงานภาพและการแสดงทำได้ประณีตทีเดียวค่ะ',
  heartbroken: 'นั่งดูแล้วใจสลายแทนตัวละครทุกคนจริงๆ ทำไมชีวิตในหนังต้องโหดร้ายขนาดนี้ ร้องไห้จนทิชชู่หมดกล่อง',
  confused: 'ดูจบแล้วงงมาก แต่รู้สึกว่ามันเท่มากจนต้องดูซ้ำรอบสองเพื่อทำความเข้าใจ ใครดูแล้วมาคุยกันหน่อย'
};

const getToken = () => localStorage.getItem('token');
const setToken = (token) => localStorage.setItem('token', token);
const removeToken = () => localStorage.removeItem('token');

async function fetchJson(url, options = {}) {
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers
  };

  const response = await fetch(fullUrl, { ...options, headers });
  
  if (!response.ok) {
    let errorMessage = `Request failed: ${response.status}`;
    try {
      const errData = await response.json();
      if (errData && errData.error) errorMessage = errData.error;
    } catch (e) {}
    throw new Error(errorMessage);
  }

  if (response.status === 204) return {};
  return response.json();
}

function attachUsernameChecker(inputId, statusId) {
  const inputEl = document.getElementById(inputId);
  const statusEl = document.getElementById(statusId);

  if (!inputEl || !statusEl) return;

  let debounceTimer = null;

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const username = inputEl.value.trim();

    if (!username) {
      statusEl.textContent = '';
      return;
    }

    statusEl.style.color = '#a09cb0';
    statusEl.textContent = 'กำลังตรวจสอบ...';

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetchJson(`/api/check-username/${encodeURIComponent(username)}`);

        if (res.available) {
          statusEl.style.color = '#4caf50';
          statusEl.textContent = `✓ ${res.message}`;
        } else {
          statusEl.style.color = '#ff7a59';
          statusEl.textContent = `✕ ${res.message}`;
        }
      } catch (error) {
        statusEl.style.color = '#ff7a59';
        statusEl.textContent = 'ไม่สามารถตรวจสอบชื่อผู้ใช้ได้';
      }
    }, 500);
  });
}

function initLoginPage() {
  const tabLogin = document.getElementById('pageTabLogin');
  const tabRegister = document.getElementById('pageTabRegister');
  const loginForm = document.getElementById('pageLoginForm');
  const regForm = document.getElementById('pageRegisterForm');
  const loginError = document.getElementById('pageLoginError');
  const regError = document.getElementById('pageRegError');

  if (!loginForm && !regForm) return;

  if (tabLogin && tabRegister && loginForm && regForm) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      loginForm.classList.remove('hidden');
      regForm.classList.add('hidden');
      if (loginError) loginError.textContent = '';
    });

    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      regForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
      if (regError) regError.textContent = '';
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (loginError) loginError.textContent = '';
      try {
        const u = document.getElementById('pageUsername').value;
        const p = document.getElementById('pagePassword').value;
        await window.handleLogin(u, p);
        window.location.href = 'index.html';
      } catch (err) {
        if (loginError) loginError.textContent = err.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      }
    });
  }

  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (regError) regError.textContent = '';
      try {
        const u = document.getElementById('pageRegUsername').value;
        const em = document.getElementById('pageRegEmail').value;
        const p = document.getElementById('pageRegPassword').value;
        await window.handleRegister(u, em, p);
        alert('สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ');
        if (tabLogin) tabLogin.click();
      } catch (err) {
        if (regError) regError.textContent = err.message || 'สมัครสมาชิกไม่สำเร็จ อาจมีผู้ใช้งานนี้แล้ว';
      }
    });
  }
}

async function initAuthNavbar() {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  const authBtn = document.getElementById('authBtn');
  const token = getToken();

  if (!token) {
    if (authBtn) authBtn.style.display = 'inline-flex';
    return;
  }

  try {
    const user = await fetchJson('/api/me');
    const avatarEl = navLinks.querySelector('.nav-avatar');
    if (avatarEl && user && user.username) {
      avatarEl.textContent = user.username.substring(0, 2).toUpperCase();
      avatarEl.title = `ผู้ใช้: ${user.username}`;
    }

    if (authBtn) authBtn.style.display = 'none';

    if (!document.getElementById('logoutBtn')) {
      const logoutBtn = document.createElement('a');
      logoutBtn.id = 'logoutBtn';
      logoutBtn.href = '#';
      logoutBtn.style.color = '#ff7a59';
      logoutBtn.style.marginLeft = '12px';
      logoutBtn.textContent = 'ออกจากระบบ';
      logoutBtn.onclick = (e) => {
        e.preventDefault();
        removeToken();
        window.location.href = 'login.html';
      };
      navLinks.appendChild(logoutBtn);
    }
  } catch (error) {
    console.error('Token หมดอายุหรือเซสชันไม่ถูกต้อง:', error);
    removeToken();
    window.location.href = 'login.html';
  }
}

function initAuthModal() {
  const modal = document.getElementById('authModal');
  const authBtn = document.getElementById('authBtn');
  const closeBtn = document.getElementById('closeModalBtn');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  const errorEl = document.getElementById('authError');

  if (!modal) return;

  if (authBtn) {
    authBtn.addEventListener('click', (e) => {
      e.preventDefault();
      modal.classList.remove('hidden');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  if (tabLogin && tabRegister && loginForm && regForm) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      loginForm.classList.remove('hidden');
      regForm.classList.add('hidden');
      if (errorEl) errorEl.textContent = '';
    });

    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      regForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
      if (errorEl) errorEl.textContent = '';
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errorEl) errorEl.textContent = '';
      try {
        const u = document.getElementById('loginUsername').value;
        const p = document.getElementById('loginPassword').value;
        await window.handleLogin(u, p);
      } catch (err) {
        if (errorEl) errorEl.textContent = err.message || 'เข้าสู่ระบบไม่สำเร็จ ตรวจสอบชื่อ/รหัสผ่าน';
      }
    });
  }

  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errorEl) errorEl.textContent = '';
      try {
        const u = document.getElementById('regUsername').value;
        const em = document.getElementById('regEmail').value;
        const p = document.getElementById('regPassword').value;
        await window.handleRegister(u, em, p);
        alert('สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ');
        if (tabLogin) tabLogin.click();
      } catch (err) {
        if (errorEl) errorEl.textContent = err.message || 'สมัครสมาชิกไม่สำเร็จ อาจมีผู้ใช้งานนี้แล้ว';
      }
    });
  }
}

function initChangePasswordForm() {
  const form = document.getElementById('changePasswordForm');
  const errorEl = document.getElementById('changePassError');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.textContent = '';

    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword !== confirmPassword) {
      if (errorEl) errorEl.textContent = 'รหัสผ่านใหม่ไม่ตรงกัน';
      return;
    }

    try {
      const res = await fetchJson('/api/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword })
      });

      alert(res.message || 'เปลี่ยนรหัสผ่านสำเร็จ! กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
      removeToken();
      window.location.href = 'login.html';
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ ตรวจสอบรหัสผ่านเดิมอีกครั้ง';
    }
  });
}

window.handleLogin = async function (username, password) {
  try {
    const data = await fetchJson('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (data.token) setToken(data.token);
    return data;
  } catch (err) {
    console.error('Login error:', err);
    throw err;
  }
};

window.handleRegister = async function (username, email, password) {
  try {
    return await fetchJson('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });
  } catch (err) {
    console.error('Register error:', err);
    throw err;
  }
};

// กัน HTML แทรกจากข้อมูลที่มาจากฐานข้อมูล/ผู้ใช้ ก่อนนำไปใส่ใน innerHTML
function escapeHTML(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function genreArt(genre) {
  const found = GENRE_ART.find((g) => (genre || '').includes(g.match));
  return found || { cls: 'poster-drama', icon: '🎬' };
}

// ---------------------------------------------------------------------------
// รูปโปสเตอร์ (admin อัปโหลดใน /admin.html) — ถ้าไม่มีรูปหรือโหลดรูปไม่ขึ้น จะกลับไปใช้สีตามแนว + ไอคอนเหมือนเดิม
// ---------------------------------------------------------------------------
function safeImageUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url, window.location.href);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
  } catch (e) {
    return '';
  }
}

const POSTER_FALLBACK = "var p=this.closest('.has-img');if(p)p.classList.add('img-failed');";

// withBackdrop = ใส่ภาพเบลอเป็นพื้นหลัง (ใช้กับการ์ดแนวนอน ให้โปสเตอร์แนวตั้งแสดงครบไม่โดนครอป)
function posterImgHTML(url, alt, { withBackdrop = false } = {}) {
  const src = safeImageUrl(url);
  if (!src) return '';
  const s = escapeHTML(src);
  const backdrop = withBackdrop ? `<img class="poster-backdrop" src="${s}" alt="" aria-hidden="true" loading="lazy" decoding="async">` : '';
  return `${backdrop}<img class="poster-img" src="${s}" alt="โปสเตอร์ ${escapeHTML(alt)}" loading="lazy" decoding="async" onerror="${POSTER_FALLBACK}">`;
}

function movieCardHTML(m) {
  // ใช้ posterClass/icon ที่มากับข้อมูลจาก API ก่อน ถ้าไม่มีค่อย fallback ไปเดาจาก genre
  const art = (m.posterClass && m.icon) ? { cls: m.posterClass, icon: m.icon } : genreArt(m.genre || '');
  const tagsList = m.tags || [];
  // แก้บั๊ก: เดิมใช้ m.rating (เรต MPAA เช่น "R","PG-13") มาโชว์เป็นดาว ทั้งที่คะแนนจริงคือ m.score
  const scoreText = (m.score === null || m.score === undefined) ? '–' : Number(m.score).toFixed(1);
  const img = posterImgHTML(m.posterUrl, m.title, { withBackdrop: true });
  return `
    <a class="ticket-card" href="detail.html?id=${encodeURIComponent(m.id)}">
      <div class="poster ${escapeHTML(art.cls)}${img ? ' has-img' : ''}">
        ${img}
        <span class="score-badge">★ ${scoreText}</span>
        <span class="icon-lg">${art.icon}</span>
      </div>
      <div class="ticket-perf"></div>
      <div class="info">
        <h3>${escapeHTML(m.title)}</h3>
        <div class="meta">${escapeHTML(m.genre)} · ${escapeHTML(m.year)}</div>
        <div class="stickers">${tagsList.map((t) => `<span class="sticker">${escapeHTML(t)}</span>`).join('')}</div>
      </div>
    </a>`;
}

// ===========================================================================
// ระบบแนะนำหนังเฉพาะบุคคล
// - หน้าแรก: "เลือกให้คุณโดยเฉพาะ" (เรียนรู้จากหนังที่เปิดดู / Watchlist / รีวิว)
// - หน้า detail: บันทึกการเปิดดู + "หนังที่คล้ายกัน"
// - หน้า profile: สรุปรสนิยม (แนวที่ชอบ ผู้กำกับที่ชอบ)
// ===========================================================================
function recoItemHTML(m) {
  return `
    <div class="reco-item" data-movie-id="${Number(m.id)}">
      ${movieCardHTML(m)}
      <div class="reco-meta">
        <span class="reco-reason reason-${escapeHTML(m.reasonType || 'popular')}">${escapeHTML(m.reason || '')}</span>
        <button type="button" class="reco-dismiss" data-movie-id="${Number(m.id)}" aria-label="ไม่สนใจเรื่อง ${escapeHTML(m.title)}">ไม่สนใจ ✕</button>
      </div>
    </div>`;
}

async function initRecommendations() {
  const grid = document.getElementById('forYouGrid');
  if (!grid) return;
  const basisEl = document.getElementById('forYouBasis');
  const noteEl = document.getElementById('forYouNote');
  const LIMIT = 8;

  async function load() {
    try {
      const data = await fetchJson(`/api/recommendations?limit=${LIMIT}`);
      if (!data.items.length) {
        grid.innerHTML = '<p style="opacity:.6;">ตอนนี้ยังไม่มีหนังให้แนะนำเพิ่ม ลองเปิดดูหนังเรื่องอื่นเพิ่มเติมนะ</p>';
        return;
      }
      grid.innerHTML = data.items.map(recoItemHTML).join('');
      if (data.personalized) {
        const genres = (data.basedOn && data.basedOn.genres || []).slice(0, 2);
        if (basisEl) basisEl.textContent = genres.length ? `จากแนวที่คุณชอบ: ${genres.join(' · ')}` : '';
        if (noteEl) noteEl.textContent = 'เรียนรู้จากหนังที่คุณเปิดดู เก็บไว้ และรีวิว — เรื่องไหนไม่ถูกใจ กด "ไม่สนใจ" ได้เลย';
      } else {
        if (basisEl) basisEl.textContent = '';
        if (noteEl) noteEl.textContent = 'ยังไม่รู้จักรสนิยมคุณเลย ลองเปิดดูหนัง เพิ่ม Watchlist หรือเขียนรีวิว แล้วรายการนี้จะเริ่มเป็นของคุณ — ตอนนี้เป็นหนังคะแนนสูงที่คนดูเยอะ';
      }
    } catch (error) {
      console.error(error);
      grid.innerHTML = '<p style="opacity:.6;">โหลดหนังแนะนำไม่สำเร็จ ลองใหม่อีกครั้ง</p>';
    }
  }

  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.reco-dismiss');
    if (!btn) return;
    btn.disabled = true;
    const item = btn.closest('.reco-item');
    try {
      await fetchJson('/api/recommendations/dismiss', {
        method: 'POST',
        body: JSON.stringify({ movieId: Number(btn.dataset.movieId) })
      });
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        // เหลือน้อยเกินไปก็ดึงชุดใหม่ (เรื่องที่เพิ่งกดไม่สนใจจะไม่กลับมา)
        if (grid.querySelectorAll('.reco-item').length < LIMIT / 2) load();
      }, 250);
    } catch (error) {
      console.error(error);
      btn.disabled = false;
      btn.textContent = 'ลองอีกครั้ง';
    }
  });

  await load();
}

async function initTasteProfile() {
  const el = document.getElementById('tasteProfile');
  if (!el) return;
  try {
    const t = await fetchJson('/api/taste-profile');
    if (!t.genres.length) {
      el.innerHTML = '<p class="taste-empty">ยังวิเคราะห์รสนิยมไม่ได้ ลองเปิดดูหนัง เพิ่ม Watchlist หรือเขียนรีวิว แล้วกลับมาดูที่นี่อีกครั้ง 🍿</p>';
      return;
    }
    const bars = t.genres.map((g) => `
      <div class="taste-row">
        <span class="taste-label">${escapeHTML(g.name)}</span>
        <div class="taste-bar"><span style="width:${Math.max(4, Number(g.share) || 0)}%"></span></div>
        <span class="taste-pct">${Number(g.share) || 0}%</span>
      </div>`).join('');
    const chips = (title, list) => list.length ? `
      <div class="taste-group">
        <div class="taste-group-title">${title}</div>
        <div class="stickers">${list.map((p) => `<span class="sticker">${escapeHTML(p.name)}</span>`).join('')}</div>
      </div>` : '';
    const decade = t.favoriteDecade ? `<div class="taste-group"><div class="taste-group-title">ยุคที่ชอบ</div><div class="stickers"><span class="sticker">${Number(t.favoriteDecade)}s</span></div></div>` : '';
    el.innerHTML = `
      <div class="taste-bars">${bars}</div>
      ${chips('ผู้กำกับที่คุณสนใจ', t.directors)}
      ${chips('นักแสดงที่คุณน่าจะชอบ', t.stars)}
      ${decade}
      <p class="taste-foot">จากหนังที่เปิดดู ${t.counts.viewed} เรื่อง · Watchlist ${t.counts.watchlist} เรื่อง · รีวิว ${t.counts.reviews} เรื่อง</p>`;
  } catch (error) {
    console.error(error);
    el.innerHTML = '<p class="taste-empty">โหลดข้อมูลรสนิยมไม่สำเร็จ ลองใหม่อีกครั้ง</p>';
  }
}

// บันทึกว่าเปิดดูหนังเรื่องนี้ (เป็นสัญญาณรสนิยมแบบเบา) นับครั้งเดียวต่อเรื่องต่อ session กันรีเฟรชรัวๆ
function trackView(movieId) {
  const key = `viewed:${movieId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch (e) { /* sessionStorage ใช้ไม่ได้ก็ข้าม */ }
  fetchJson('/api/views', { method: 'POST', body: JSON.stringify({ movieId: Number(movieId) }) }).catch(() => {});
}

async function initSimilarMovies(movieId) {
  const section = document.getElementById('similarSection');
  const grid = document.getElementById('similarGrid');
  if (!section || !grid) return;
  try {
    const items = await fetchJson(`/api/movies/${encodeURIComponent(movieId)}/similar?limit=4`);
    if (!Array.isArray(items) || !items.length) return;
    grid.innerHTML = items.map((m) => `
      <div class="reco-item">
        ${movieCardHTML(m)}
        <div class="reco-meta"><span class="reco-reason reason-similar">${escapeHTML(m.reason || '')}</span></div>
      </div>`).join('');
    section.hidden = false;
  } catch (error) {
    console.error(error);
  }
}

// ---------------------------------------------------------------------------
// หน้าแรก: หนังกำลังมาแรง 10 อันดับ (เลื่อนได้ด้วยนิ้ว / ปุ่มลูกศร / จุด และเลื่อนเองทุก 5 วินาที)
// ---------------------------------------------------------------------------
function trendSlideHTML(m) {
  const art = (m.posterClass && m.icon) ? { cls: m.posterClass, icon: m.icon } : genreArt(m.genre || '');
  const img = posterImgHTML(m.posterUrl, m.title);
  const score = (m.score === null || m.score === undefined) ? '' : `<span class="trend-score">★ ${Number(m.score).toFixed(1)}</span>`;
  return `
    <a class="trend-slide" href="detail.html?id=${encodeURIComponent(m.id)}" aria-label="อันดับ ${Number(m.rank)}: ${escapeHTML(m.title)}">
      <div class="trend-poster ${escapeHTML(art.cls)}${img ? ' has-img' : ''}">
        ${img}
        <span class="trend-rank">#${Number(m.rank)}</span>
        ${score}
        <span class="icon-lg">${art.icon}</span>
      </div>
      <div class="ticket-perf"></div>
      <div class="showcase-info">
        <h3 title="${escapeHTML(m.title)}">${escapeHTML(m.title)}</h3>
        <div class="meta">${escapeHTML(m.genre || '')}${m.year ? ` · ${escapeHTML(m.year)}` : ''}</div>
        <div class="trend-reason">${escapeHTML(m.reason && m.reason !== 'คะแนนสูง' ? `🔥 ${m.reason}` : '')}</div>
      </div>
    </a>`;
}

async function initTrending() {
  const track = document.getElementById('trendTrack');
  if (!track) return;
  const showcase = document.getElementById('trendShowcase');
  const controls = document.getElementById('trendControls');
  const dotsEl = document.getElementById('trendDots');
  const prevBtn = document.getElementById('trendPrev');
  const nextBtn = document.getElementById('trendNext');

  let items = [];
  try {
    items = await fetchJson('/api/movies/trending?limit=10');
  } catch (error) {
    console.error(error);
  }
  if (!Array.isArray(items) || !items.length) {
    const h3 = track.querySelector('h3');
    if (h3) h3.textContent = 'โหลดหนังมาแรงไม่สำเร็จ ลองรีเฟรชอีกครั้ง';
    return;
  }

  track.innerHTML = items.map(trendSlideHTML).join('');
  dotsEl.innerHTML = items.map((m, i) => `<button type="button" class="trend-dot${i === 0 ? ' active' : ''}" role="tab" aria-label="อันดับ ${i + 1}" data-i="${i}"></button>`).join('');
  controls.hidden = items.length < 2;

  const count = items.length;
  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const goTo = (i) => track.scrollTo({ left: ((i + count) % count) * track.clientWidth });

  let raf = null;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const idx = current();
      dotsEl.querySelectorAll('.trend-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    });
  });
  prevBtn.addEventListener('click', () => { goTo(current() - 1); restart(); });
  nextBtn.addEventListener('click', () => { goTo(current() + 1); restart(); });
  dotsEl.addEventListener('click', (e) => {
    const dot = e.target.closest('.trend-dot');
    if (dot) { goTo(Number(dot.dataset.i)); restart(); }
  });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current() + 1); restart(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current() - 1); restart(); }
  });

  // เลื่อนเองทุก 5 วินาที — หยุดตอนเอาเมาส์ชี้/แตะ/โฟกัส และปิดถ้าผู้ใช้ตั้งค่าลดการเคลื่อนไหว
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = null;
  let paused = false;
  function start() {
    if (reduceMotion || count < 2) return;
    clearInterval(timer);
    timer = setInterval(() => { if (!paused && !document.hidden) goTo(current() + 1); }, 5000);
  }
  function restart() { start(); }
  ['mouseenter', 'focusin', 'touchstart'].forEach((ev) => showcase.addEventListener(ev, () => { paused = true; }, { passive: true }));
  ['mouseleave', 'focusout'].forEach((ev) => showcase.addEventListener(ev, () => { paused = false; }));
  showcase.addEventListener('touchend', () => { setTimeout(() => { paused = false; }, 4000); }, { passive: true });
  start();
}

async function getMovies() {
  if (MOVIES.length) return MOVIES;
  try {
    const movies = await fetchJson('/api/movies');
    MOVIES.push(...movies);
    return MOVIES;
  } catch (error) {
    console.error(error);
    return [];
  }
}

async function initMoodPicker() {
  const chips = document.querySelectorAll('.mood-chip');
  if (!chips.length) return;
  const readoutEl = document.getElementById('moodReadout');
  const moviesEl = document.getElementById('moodMovies');

  // เดิม: หมุน index ใน array เดิมไปเรื่อยๆ ตามเลข mood ไม่ได้เลือกหนังตามอารมณ์จริง
  // ตอนนี้: ยิงไป backend ให้กรองตาม genre ที่เข้ากับ mood นั้นๆ จริง (ดู MOOD_GENRES ใน movies.js)
  async function render(val) {
    chips.forEach((c) => c.classList.toggle('selected', Number(c.dataset.mood) === val));
    if (readoutEl) readoutEl.textContent = MOOD_META[val];
    if (moviesEl) moviesEl.innerHTML = '<p style="opacity:.6;">กำลังเลือกหนังให้...</p>';
    try {
      const picks = await fetchJson(`/api/movies?mood=${val}&limit=3`);
      if (moviesEl) moviesEl.innerHTML = picks.map(movieCardHTML).join('');
    } catch (error) {
      console.error(error);
      if (moviesEl) moviesEl.innerHTML = '<p style="opacity:.6;">โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง</p>';
    }
  }

  chips.forEach((chip) => {
    chip.addEventListener('click', () => render(Number(chip.dataset.mood)));
  });

  render(3);
}

async function initSearchPage() {
  const grid = document.getElementById('resultsGrid');
  if (!grid) return;
  const SF = window.SearchFilters;
  const emptyState = document.getElementById('emptyState');
  const vibeButtons = document.querySelectorAll('.tag-btn[data-tag]');
  const genreWrap = document.getElementById('genreFilters');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const clearBtn = document.getElementById('clearFiltersBtn');
  const resetBtn = document.getElementById('resetFiltersBtn');
  const yearFromEl = document.getElementById('yearFrom');
  const yearToEl = document.getElementById('yearTo');
  const minScoreEl = document.getElementById('minScore');
  const sortEl = document.getElementById('sortBy');
  const resultsCount = document.getElementById('resultsCount');
  const resultsTitle = document.getElementById('resultsTitle');

  const movies = await getMovies();
  const state = { q: '', vibes: new Set(), genres: new Set(), yearFrom: '', yearTo: '', minScore: '', sort: 'score' };

  // ตัวเลือกประเภทหนัง + ช่วงปี สร้างจากข้อมูลที่มีจริงในระบบ (เพิ่มหนังประเภทใหม่/ปีใหม่ → โผล่เองอัตโนมัติ)
  const facets = SF.buildFacets(movies);
  if (genreWrap) {
    genreWrap.innerHTML = facets.genres.map((g) => (
      `<button type="button" class="tag-btn" data-genre="${escapeHTML(g.value)}">${genreArt(g.value).icon} ${escapeHTML(g.label)} <span class="tag-count">${g.count}</span></button>`
    )).join('');
  }
  const yearOptions = '<option value="">ทุกปี</option>' + facets.years.map((y) => `<option value="${y}">${y}</option>`).join('');
  if (yearFromEl) yearFromEl.innerHTML = yearOptions;
  if (yearToEl) yearToEl.innerHTML = yearOptions;
  if (sortEl) sortEl.innerHTML = Object.entries(SF.SORTS).map(([k, label]) => `<option value="${k}">${label}</option>`).join('');

  function render() {
    const filtered = SF.applyFilters(movies, state);
    const active = SF.hasActiveFilters(state);
    if (filtered.length === 0) {
      grid.innerHTML = '';
      if (emptyState) emptyState.classList.add('show');
    } else {
      if (emptyState) emptyState.classList.remove('show');
      grid.innerHTML = filtered.map(movieCardHTML).join('');
    }
    if (resultsCount) resultsCount.textContent = `${filtered.length} เรื่อง`;
    if (resultsTitle) resultsTitle.textContent = active ? 'ผลลัพธ์ที่ตรงกับตัวกรอง' : 'หนังทั้งหมด';
    if (resetBtn) resetBtn.style.display = active ? 'inline-flex' : 'none';
  }

  function toggleIn(set, value, btn) {
    if (set.has(value)) { set.delete(value); btn.classList.remove('selected'); }
    else { set.add(value); btn.classList.add('selected'); }
    render();
  }

  vibeButtons.forEach((btn) => btn.addEventListener('click', () => toggleIn(state.vibes, btn.dataset.tag, btn)));
  if (genreWrap) {
    genreWrap.querySelectorAll('.tag-btn[data-genre]').forEach((btn) => {
      btn.addEventListener('click', () => toggleIn(state.genres, btn.dataset.genre, btn));
    });
  }

  // ช่วงปี: ถ้าเลือก "ตั้งแต่" มากกว่า "ถึง" ให้ปรับอีกช่องตามอัตโนมัติ
  if (yearFromEl) {
    yearFromEl.addEventListener('change', () => {
      state.yearFrom = yearFromEl.value;
      if (state.yearFrom && state.yearTo && Number(state.yearFrom) > Number(state.yearTo)) {
        state.yearTo = state.yearFrom;
        yearToEl.value = state.yearTo;
      }
      render();
    });
  }
  if (yearToEl) {
    yearToEl.addEventListener('change', () => {
      state.yearTo = yearToEl.value;
      if (state.yearFrom && state.yearTo && Number(state.yearTo) < Number(state.yearFrom)) {
        state.yearFrom = state.yearTo;
        yearFromEl.value = state.yearFrom;
      }
      render();
    });
  }
  if (minScoreEl) minScoreEl.addEventListener('change', () => { state.minScore = minScoreEl.value; render(); });
  if (sortEl) sortEl.addEventListener('change', () => { state.sort = sortEl.value; render(); });

  // พิมพ์แล้วกรองทันที (หน่วงนิดเดียวไม่ให้กระตุก) / กด Enter / กดปุ่มค้นหา ก็ได้
  let typingTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { state.q = searchInput.value; render(); }, 180);
    });
    searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') { state.q = searchInput.value; render(); } });
  }
  if (searchBtn) searchBtn.addEventListener('click', () => { state.q = searchInput ? searchInput.value : ''; render(); });

  function resetAll() {
    state.q = ''; state.vibes.clear(); state.genres.clear();
    state.yearFrom = ''; state.yearTo = ''; state.minScore = ''; state.sort = 'score';
    if (searchInput) searchInput.value = '';
    document.querySelectorAll('.tag-btn.selected').forEach((b) => b.classList.remove('selected'));
    if (yearFromEl) yearFromEl.value = '';
    if (yearToEl) yearToEl.value = '';
    if (minScoreEl) minScoreEl.value = '';
    if (sortEl) sortEl.value = 'score';
    render();
  }
  if (clearBtn) clearBtn.addEventListener('click', resetAll);
  if (resetBtn) resetBtn.addEventListener('click', resetAll);

  render();
}

function initSpoilerShield() {
  const spoilerWraps = document.querySelectorAll('.spoiler-wrap');
  spoilerWraps.forEach((wrap) => {
    const btn = wrap.querySelector('.spoiler-btn');
    const overlay = wrap.querySelector('.spoiler-overlay');
    const text = wrap.querySelector('.spoiler-blur');
    const countEl = wrap.querySelector('.spoiler-count');
    if (!btn) return;
    
    let clicks = 0;
    btn.addEventListener('click', () => {
      clicks += 1;
      if (countEl) countEl.textContent = `คลิกแล้ว ${clicks} / 3`;
      if (clicks >= 3) {
        if (text) text.classList.add('revealed');
        if (overlay) overlay.classList.add('hidden');
      }
    });
  });
}

function initWriteReview() {
  const select = document.getElementById('templateSelect');
  if (!select) return;
  const aiBtn = document.getElementById('aiGenerateBtn');
  const textarea = document.getElementById('reviewText');
  const popcorns = document.querySelectorAll('#popcornRow span');
  const submitBtn = document.getElementById('submitReviewBtn');
  const heading = document.querySelector('main h1');

  const params = new URLSearchParams(window.location.search);
  const movieId = params.get('id');

  if (heading) {
    heading.textContent = movieId ? 'เขียนรีวิวหนังเรื่องนี้' : heading.textContent;
  }

  // เดิม: ถ้าไม่มี ?id= ใน URL จะยิง movieId เป็น 'signal-from-space' ซึ่งเป็น id เก่าที่ไม่มีอยู่จริงแล้ว
  // ทำให้ส่งรีวิวไปแล้วเงียบๆ ไม่ผูกกับหนังเรื่องไหนเลย ตอนนี้บล็อกการส่งแทน พร้อมแจ้งเตือนให้ชัดเจน
  if (!movieId && submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'ไม่พบหนังที่จะรีวิว กรุณาเลือกหนังก่อน';
    return;
  }

  let ratingValue = 0;
  popcorns.forEach((p) => {
    p.addEventListener('click', () => {
      ratingValue = Number(p.dataset.val);
      popcorns.forEach((s) => s.classList.toggle('active', Number(s.dataset.val) <= ratingValue));
    });
  });

  if (aiBtn) {
    aiBtn.addEventListener('click', () => {
      const key = select.value;
      if (!key) {
        select.focus();
        return;
      }
      textarea.value = REVIEW_TEMPLATES[key];
    });
  }

  if (submitBtn) {
    const spoilerSelect = document.getElementById('spoilerSelect');
    submitBtn.addEventListener('click', async () => {
      if (!textarea.value.trim()) {
        textarea.focus();
        return;
      }
      const originalLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'กำลังส่งรีวิว...';
      try {
        let authorName = 'สมาชิกทั่วไป';
        const token = getToken();
        if (token) {
          try {
            const currentUser = await fetchJson('/api/me');
            if (currentUser && currentUser.username) {
              authorName = currentUser.username;
            }
          } catch (e) {
            console.warn('ดึงข้อมูลชื่อผู้เขียนไม่สำเร็จ ใช้ชื่อเริ่มต้นแทน:', e);
          }
        }

        await fetchJson('/api/reviews', {
          method: 'POST',
          body: JSON.stringify({
            movieId,
            author: authorName,
            rating: ratingValue || 5,
            text: textarea.value,
            spoiler: Boolean(spoilerSelect && spoilerSelect.value === 'yes')
          })
        });
        submitBtn.textContent = 'ส่งรีวิวแล้ว ✓ +50 XP';
        // ส่งเสร็จให้เด้งออกจากหน้าเขียนรีวิว ไปหน้าหนังเรื่องนี้ (เห็นรีวิวที่เพิ่งเขียน) จะได้ค้นหาหนังเรื่องต่อไปได้เลย
        // ใช้ replace เพื่อไม่ให้กดย้อนกลับแล้วกลับมาเจอฟอร์มรีวิวที่ส่งไปแล้ว
        setTimeout(() => { window.location.replace(`detail.html?id=${encodeURIComponent(movieId)}`); }, 900);
      } catch (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
        alert(`ส่งรีวิวไม่สำเร็จ: ${error.message || 'กรุณาลองใหม่อีกครั้ง'}`);
        console.error(error);
      }
    });
  }
}

async function initWatchlistPage() {
  const container = document.getElementById('watchlistItems');
  if (!container) return;
  try {
    const watchlist = await fetchJson('/api/watchlist');
    container.innerHTML = watchlist.map((movie) => {
      const img = posterImgHTML(movie.posterUrl, movie.title);
      return `
      <div class="watch-row">
        <a href="detail.html?id=${encodeURIComponent(movie.id)}" class="poster-sm ${escapeHTML(movie.posterClass || 'poster-drama')}${img ? ' has-img' : ''}" style="display:flex;align-items:center;justify-content:center;font-size:1.6rem;">${img}<span class="icon-lg">${movie.icon || '🎬'}</span></a>
        <div class="grow">
          <h4>${escapeHTML(movie.title)}</h4>
          <div class="meta">${escapeHTML(movie.genre)} · ${escapeHTML(movie.year)}</div>
        </div>
        <button class="btn btn-ghost btn-sm story-btn" data-title="${escapeHTML(movie.title)}" data-tag="${escapeHTML((movie.tags && movie.tags[0]) || 'หนังดี')}">📸 Generate Story Card</button>
      </div>`;
    }).join('');
  } catch (error) {
    console.error(error);
  }
  initStoryGenerator();
}

async function initProfilePage() {
  const nameEl = document.getElementById('profileName');
  const levelEl = document.getElementById('profileLevel');
  const xpEl = document.getElementById('profileXp');
  const badgeContainer = document.getElementById('badgeGrid');
  if (!nameEl && !levelEl && !badgeContainer) return;

  try {
    const profile = await fetchJson('/api/profile');
    if (nameEl) nameEl.textContent = profile.name;
    if (levelEl) levelEl.textContent = `Lv.${profile.level} · ${profile.name}`;
    if (xpEl) xpEl.textContent = `${profile.xp} / ${profile.nextLevelXp} XP ถึง Lv.${profile.level + 1}`;
    if (badgeContainer) {
      badgeContainer.innerHTML = profile.badges.map((badge) => `
        <div class="badge ${badge.unlocked ? 'unlocked' : 'locked'}">
          <span class="icon">${badge.unlocked ? '🏅' : '🔒'}</span>${badge.name}
        </div>`).join('');
    }
  } catch (error) {
    console.error(error);
  }
}

function formatVotes(votes) {
  const n = Number(votes);
  if (!Number.isFinite(n) || n <= 0) return '–';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

async function initDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const movieIdParam = params.get('id');
  const poster = document.querySelector('.poster-lg');
  const eyebrow = document.querySelector('.detail-hero .eyebrow');
  const title = document.querySelector('.detail-hero h1');
  const synopsis = document.querySelector('.detail-hero p');
  const ratingCells = document.querySelectorAll('.rating-chip .num');
  const ratingLabels = document.querySelectorAll('.rating-chip .lbl');
  const tags = document.querySelector('.detail-hero .stickers');
  const reviewSection = document.querySelector('main .wrap > section');
  const writeBtn = document.getElementById('writeReviewBtn');
  const watchlistBtn = document.getElementById('addWatchlistBtn');

  if (!poster && !eyebrow && !title && !synopsis && !tags) return;
  if (!movieIdParam) {
    if (title) title.textContent = 'ไม่พบหนังที่ต้องการดู';
    if (synopsis) synopsis.textContent = 'กรุณากลับไปเลือกหนังจากหน้าแรกหรือหน้าค้นหาอีกครั้ง';
    return;
  }

  try {
    const movie = await fetchJson(`/api/movies/${movieIdParam}`);
    if (poster) {
      const img = posterImgHTML(movie.posterUrl, movie.title);
      poster.className = `poster-lg ${movie.posterClass || 'poster-drama'}${img ? ' has-img' : ''}`;
      poster.innerHTML = `${img}<span class="icon-lg" style="font-size:4.5rem;">${movie.icon || '🎬'}</span>`;
    }
    if (eyebrow) eyebrow.textContent = `${movie.icon || '🎬'} ${movie.genre} · ${movie.year}`;
    if (title) title.textContent = movie.title;
    if (synopsis) synopsis.textContent = movie.synopsis;
    // เดิม: cell ที่ 2-4 (บทหนัง/งานภาพ/จังหวะตัดต่อ) เป็นตัวเลข hardcode ตายตัวทุกเรื่อง (4.9/4.2/3.8)
    // ตอนนี้เปลี่ยนไปโชว์ข้อมูลจริงของหนังเรื่องนั้นแทน: ปี, ความยาว, จำนวนโหวต
    if (ratingLabels.length >= 4) {
      ratingLabels[0].textContent = 'คะแนนรวม';
      ratingLabels[1].textContent = 'ปีที่ฉาย';
      ratingLabels[2].textContent = 'ความยาว (นาที)';
      ratingLabels[3].textContent = 'จำนวนโหวต';
    }
    if (ratingCells.length >= 4) {
      ratingCells[0].textContent = movie.score === null || movie.score === undefined ? '–' : Number(movie.score).toFixed(1);
      ratingCells[1].textContent = movie.year || '–';
      ratingCells[2].textContent = movie.runtime || '–';
      ratingCells[3].textContent = formatVotes(movie.votes);
    }
    if (tags && movie.tags) {
      tags.innerHTML = movie.tags.map((tag) => `<span class="sticker">${escapeHTML(tag)}</span>`).join('');
    }
    if (writeBtn) {
      writeBtn.addEventListener('click', () => {
        window.location.href = `write-review.html?id=${encodeURIComponent(movie.id)}`;
      });
    }
    if (watchlistBtn) {
      initWatchlistButton(watchlistBtn, movie.id);
    }
    // ระบบแนะนำ: จดว่าผู้ใช้เปิดดูเรื่องนี้ + โชว์หนังที่คล้ายกัน (ไม่รอ ไม่ให้ขวางการโหลดรีวิว)
    trackView(movie.id);
    initSimilarMovies(movie.id);
    if (reviewSection) {
      // แก้บั๊ก: เดิมเทียบ item.movieId (string จาก URL param) === movie.id (number จาก API)
      // ซึ่งเป็นคนละชนิดข้อมูลเลยไม่ตรงกันเกือบทุกครั้ง ตอนนี้แปลงเป็น Number ทั้งคู่ก่อนเทียบ
      const reviews = await fetchJson(`/api/reviews?movieId=${encodeURIComponent(movie.id)}`).catch(async () => {
        const all = await fetchJson('/api/reviews');
        return all.filter((item) => Number(item.movieId) === Number(movie.id));
      });
      const movieReviews = Array.isArray(reviews)
        ? reviews.filter((item) => Number(item.movieId) === Number(movie.id))
        : [];
      reviewSection.innerHTML = `
        <div class="section-head"><h2>รีวิวจากนักวิจารณ์</h2></div>
        ${movieReviews.length ? movieReviews.map((review) => `
          <div class="review-block">
            <div class="author">🧑‍🚀 ${escapeHTML(review.author)} · ${new Date(review.createdAt).toLocaleDateString('th-TH')} · 🍿${escapeHTML(review.rating)}</div>
            ${review.spoiler ? '' : `<p>${escapeHTML(review.text)}</p>`}
            ${review.spoiler ? `
              <div class="spoiler-wrap">
                <p class="spoiler-blur">${escapeHTML(review.text)}</p>
                <div class="spoiler-overlay">
                  <button class="btn btn-ghost btn-sm spoiler-btn">🙈 คลิกยืนยัน 3 ครั้งเพื่อดูสปอยล์</button>
                  <span class="count spoiler-count">คลิกแล้ว 0 / 3</span>
                </div>
              </div>` : ''}
          </div>`).join('') : '<div class="review-block"><p>ยังไม่มีรีวิวสำหรับเรื่องนี้ ลองเขียนรีวิวแรกของคุณดูสิ</p></div>'}
      `;
    }
    initSpoilerShield();
  } catch (error) {
    console.error(error);
  }
}

// เดิม: ปุ่ม "＋ เพิ่มลง Watchlist" ในหน้า detail ไม่มี id และไม่มี event listener ผูกอยู่เลย
// กดแล้วไม่มีอะไรเกิดขึ้น ตอนนี้ผูกกับ API /api/watchlist จริง พร้อม toggle เพิ่ม/ลบ
async function initWatchlistButton(btn, movieId) {
  let inWatchlist = false;
  try {
    const list = await fetchJson('/api/watchlist');
    inWatchlist = Array.isArray(list) && list.some((m) => Number(m.id) === Number(movieId));
  } catch (error) {
    // ไม่ได้ล็อกอินหรือดึงไม่สำเร็จ ปล่อยเป็นค่าเริ่มต้น (ยังไม่อยู่ใน watchlist)
  }

  function setLabel() {
    btn.textContent = inWatchlist ? '✓ อยู่ใน Watchlist แล้ว' : '＋ เพิ่มลง Watchlist';
  }
  setLabel();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      if (inWatchlist) {
        await fetchJson(`/api/watchlist/${encodeURIComponent(movieId)}`, { method: 'DELETE' });
        inWatchlist = false;
      } else {
        await fetchJson('/api/watchlist', { method: 'POST', body: JSON.stringify({ movieId }) });
        inWatchlist = true;
      }
      setLabel();
    } catch (error) {
      console.error(error);
    } finally {
      btn.disabled = false;
    }
  });
}

function initStoryGenerator() {
  const buttons = document.querySelectorAll('.story-btn');
  if (!buttons.length) return;
  const canvas = document.getElementById('storyCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.title;
      const tag = btn.dataset.tag;

      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#1c1730');
      grad.addColorStop(0.55, '#3a2350');
      grad.addColorStop(1, '#5c2f3a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i += 1) {
        ctx.beginPath();
        ctx.moveTo(0, 120 + i * 130);
        ctx.lineTo(canvas.width, 60 + i * 130);
        ctx.stroke();
      }

      ctx.fillStyle = '#ffc857';
      ctx.font = "700 24px 'Baloo 2', sans-serif";
      ctx.fillText('🎬 CINESUPERNOVA', 40, 90);

      ctx.fillStyle = '#f8f5ff';
      ctx.font = "700 42px 'Baloo 2', sans-serif";
      wrapText(ctx, title, 40, 460, 460, 50);

      ctx.fillStyle = '#ff7a59';
      ctx.font = "600 24px 'IBM Plex Sans Thai', sans-serif";
      ctx.fillText(`#${tag}`, 40, 620);

      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = "400 18px 'IBM Plex Sans Thai', sans-serif";
      ctx.fillText('อยู่ใน Watchlist ของฉัน →', 40, 900);

      canvas.style.display = 'block';
      const link = document.createElement('a');
      link.download = `${title}-story.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      canvas.style.display = 'none';
    });
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split('');
  let line = '';
  let curY = y;
  for (let i = 0; i < words.length; i += 1) {
    const testLine = line + words[i];
    if (ctx.measureText(testLine).width > maxWidth && line !== '') {
      ctx.fillText(line, x, curY);
      line = words[i];
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, curY);
}

// ---------- ลืมรหัสผ่าน (ปุ่มในหน้า login) ----------
function initForgotPassword() {
  const link = document.getElementById('forgotLink');
  const form = document.getElementById('pageForgotForm');
  if (!link || !form) return;

  const tabs = document.querySelector('.auth-tabs');
  const loginForm = document.getElementById('pageLoginForm');
  const regForm = document.getElementById('pageRegisterForm');
  const tabLogin = document.getElementById('pageTabLogin');
  const tabRegister = document.getElementById('pageTabRegister');
  const emailInput = document.getElementById('pageForgotEmail');
  const msg = document.getElementById('pageForgotMsg');
  const demoBox = document.getElementById('pageForgotDemo');
  const btn = document.getElementById('pageForgotBtn');
  const back = document.getElementById('forgotBack');

  function setMsg(text, ok) {
    msg.textContent = text;
    msg.classList.toggle('success-msg', Boolean(ok));
    msg.classList.toggle('error-msg', !ok);
  }

  link.addEventListener('click', () => {
    if (tabs) tabs.classList.add('hidden');
    if (loginForm) loginForm.classList.add('hidden');
    if (regForm) regForm.classList.add('hidden');
    form.classList.remove('hidden');
    setMsg('', true);
    demoBox.classList.add('hidden');
    const typed = (document.getElementById('pageUsername') || {}).value || '';
    if (typed.includes('@') && !emailInput.value) emailInput.value = typed.trim();
    emailInput.focus();
  });

  back.addEventListener('click', () => {
    form.classList.add('hidden');
    if (tabs) tabs.classList.remove('hidden');
    if (tabLogin) tabLogin.classList.add('active');
    if (tabRegister) tabRegister.classList.remove('active');
    if (loginForm) loginForm.classList.remove('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMsg('', true);
    demoBox.classList.add('hidden');
    demoBox.textContent = '';
    const email = emailInput.value.trim();
    if (!email) {
      setMsg('กรุณากรอกอีเมล', false);
      return;
    }
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'กำลังส่ง...';
    try {
      const res = await fetchJson('/api/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setMsg(res.message || 'ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว', true);
      // โหมดสาธิต (เซิร์ฟเวอร์ตั้ง PASSWORD_RESET_DEMO=true): โชว์ลิงก์ให้กดเลย ไม่ต้องรออีเมล
      if (res.demoResetLink) {
        demoBox.textContent = 'โหมดสาธิต: ';
        const a = document.createElement('a');
        a.href = res.demoResetLink;
        a.textContent = 'เปิดลิงก์ตั้งรหัสผ่านใหม่';
        demoBox.appendChild(a);
        demoBox.classList.remove('hidden');
      }
      btn.textContent = 'ส่งแล้ว ✓';
      setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 8000);
    } catch (err) {
      setMsg(err.message || 'ส่งลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', false);
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

// ปุ่ม "ส่งลิงก์ตั้งรหัสใหม่ไปที่อีเมลของฉัน" ในหน้าโปรไฟล์ (กรณีจำรหัสเดิมไม่ได้)
function initSendResetToMe() {
  const btn = document.getElementById('sendResetToMeBtn');
  const msgEl = document.getElementById('sendResetToMeMsg');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const me = await fetchJson('/api/me');
      const res = await fetchJson('/api/forgot-password', { method: 'POST', body: JSON.stringify({ email: me.email }) });
      if (msgEl) { msgEl.style.color = '#7ee8c0'; msgEl.textContent = `${res.message} (${me.email})`; }
    } catch (err) {
      if (msgEl) { msgEl.style.color = '#ff7a59'; msgEl.textContent = err.message || 'ส่งลิงก์ไม่สำเร็จ'; }
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- หน้าตั้งรหัสผ่านใหม่ (reset-password.html — เปิดจากลิงก์ในอีเมล) ----------
function initResetPassword() {
  const form = document.getElementById('resetForm');
  if (!form) return;

  const token = new URLSearchParams(window.location.search).get('token') || '';
  const invalidBox = document.getElementById('resetInvalid');
  const msg = document.getElementById('resetMsg');
  const btn = document.getElementById('resetBtn');
  const pw1 = document.getElementById('resetPassword');
  const pw2 = document.getElementById('resetPassword2');

  function setMsg(text, ok) {
    msg.textContent = text;
    msg.classList.toggle('success-msg', Boolean(ok));
    msg.classList.toggle('error-msg', !ok);
  }
  function showInvalid() {
    form.classList.add('hidden');
    invalidBox.classList.remove('hidden');
  }

  (async () => {
    if (!token) { showInvalid(); return; }
    try {
      const res = await fetchJson(`/api/reset-password/check?token=${encodeURIComponent(token)}`);
      if (res.valid) form.classList.remove('hidden');
      else showInvalid();
    } catch (err) {
      form.classList.remove('hidden'); // เช็คไม่ได้ (เน็ตสะดุด) ให้กรอกได้ก่อน เดี๋ยวเซิร์ฟเวอร์ตรวจอีกรอบตอนส่ง
    }
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMsg('', true);
    if (pw1.value.length < 6) { setMsg('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', false); return; }
    if (pw1.value !== pw2.value) { setMsg('รหัสผ่านทั้งสองช่องไม่ตรงกัน', false); return; }
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';
    try {
      const res = await fetchJson('/api/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword: pw1.value }) });
      removeToken(); // ทุกอุปกรณ์ถูกเตะออกแล้ว ล้าง token เก่าที่ค้างในเครื่องนี้ด้วย
      setMsg(`${res.message || 'ตั้งรหัสผ่านใหม่สำเร็จ'} — กำลังพาไปหน้าเข้าสู่ระบบ...`, true);
      btn.textContent = 'สำเร็จ ✓';
      setTimeout(() => { window.location.href = 'login.html'; }, 2200);
    } catch (err) {
      setMsg(err.message || 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองใหม่', false);
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
  initForgotPassword();
  initResetPassword();
  initAuthNavbar();
  initAuthModal();
  initChangePasswordForm();
  initSendResetToMe();
  // มาจากลิงก์ "ไม่ใช่ฉัน" ในอีเมลแจ้งเปลี่ยนรหัส -> เปิดฟอร์มลืมรหัสผ่านให้เลย
  if (new URLSearchParams(window.location.search).has('forgot') && document.getElementById('forgotLink')) {
    removeToken();
    document.getElementById('forgotLink').click();
  }

  attachUsernameChecker('regUsername', 'modalUsernameStatus');
  attachUsernameChecker('pageRegUsername', 'pageUsernameStatus');

  initTrending();
  initMoodPicker();
  initRecommendations();
  initTasteProfile();
  initSearchPage();
  initSpoilerShield();
  initWriteReview();
  initWatchlistPage();
  initProfilePage();
  initDetailPage();
});