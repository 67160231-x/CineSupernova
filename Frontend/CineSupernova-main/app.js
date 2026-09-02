// --- Auth Guard Check (ดักผู้ใช้ที่ยังไม่ได้ล็อกอิน) ---
(function checkAuth() {
  const token = localStorage.getItem('token');
  let currentPage = window.location.pathname.split('/').pop().toLowerCase();
  
  // รองรับกรณีเข้าผ่าน Root Path ('/')
  if (!currentPage) currentPage = 'index.html';

  const publicPages = ['login.html'];

  if (!token && !publicPages.includes(currentPage)) {
    window.location.href = 'login.html';
  }
  if (token && currentPage === 'login.html') {
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

function genreArt(genre) {
  const found = GENRE_ART.find((g) => (genre || '').includes(g.match));
  return found || { cls: 'poster-drama', icon: '🎬' };
}

function movieCardHTML(m) {
  // ใช้ posterClass/icon ที่มากับข้อมูลจาก API ก่อน ถ้าไม่มีค่อย fallback ไปเดาจาก genre
  const art = (m.posterClass && m.icon) ? { cls: m.posterClass, icon: m.icon } : genreArt(m.genre || '');
  const tagsList = m.tags || [];
  // แก้บั๊ก: เดิมใช้ m.rating (เรต MPAA เช่น "R","PG-13") มาโชว์เป็นดาว ทั้งที่คะแนนจริงคือ m.score
  const scoreText = (m.score === null || m.score === undefined) ? '–' : Number(m.score).toFixed(1);
  return `
    <a class="ticket-card" href="detail.html?id=${encodeURIComponent(m.id)}">
      <div class="poster ${art.cls}">
        <span class="score-badge">★ ${scoreText}</span>
        <span class="icon-lg">${art.icon}</span>
      </div>
      <div class="ticket-perf"></div>
      <div class="info">
        <h3>${m.title}</h3>
        <div class="meta">${m.genre} · ${m.year}</div>
        <div class="stickers">${tagsList.map((t) => `<span class="sticker">${t}</span>`).join('')}</div>
      </div>
    </a>`;
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
  const emptyState = document.getElementById('emptyState');
  const tagButtons = document.querySelectorAll('.tag-btn');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const clearBtn = document.getElementById('clearFiltersBtn');
  const resultsCount = document.getElementById('resultsCount');
  const resultsTitle = document.getElementById('resultsTitle');

  const movies = await getMovies();
  const selectedTags = new Set();

  function applyFilters() {
    const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const filtered = movies.filter((m) => {
      const matchesText = !q || m.title.toLowerCase().includes(q) || (m.genre && m.genre.toLowerCase().includes(q));
      const matchesTags = selectedTags.size === 0 || (m.tags && m.tags.some((t) => selectedTags.has(t)));
      return matchesText && matchesTags;
    });

    if (filtered.length === 0) {
      grid.innerHTML = '';
      if (emptyState) emptyState.classList.add('show');
      if (resultsCount) resultsCount.textContent = '0 เรื่อง';
    } else {
      if (emptyState) emptyState.classList.remove('show');
      grid.innerHTML = filtered.map(movieCardHTML).join('');
      if (resultsCount) resultsCount.textContent = `${filtered.length} เรื่อง`;
    }
    if (resultsTitle) resultsTitle.textContent = selectedTags.size ? 'ผลลัพธ์ที่ตรง Vibe' : 'หนังทั้งหมด';
  }

  tagButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
        btn.classList.remove('selected');
      } else {
        selectedTags.add(tag);
        btn.classList.add('selected');
      }
      applyFilters();
    });
  });

  if (searchBtn) searchBtn.addEventListener('click', applyFilters);
  if (searchInput) searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') applyFilters(); });
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      selectedTags.clear();
      if (searchInput) searchInput.value = '';
      tagButtons.forEach((b) => b.classList.remove('selected'));
      applyFilters();
    });
  }

  applyFilters();
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
    submitBtn.addEventListener('click', async () => {
      if (!textarea.value.trim()) {
        textarea.focus();
        return;
      }
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
            spoiler: false
          })
        });
        submitBtn.textContent = 'ส่งรีวิวแล้ว ✓ +50 XP';
        submitBtn.disabled = true;
      } catch (error) {
        submitBtn.textContent = 'ส่งรีวิวไม่สำเร็จ';
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
    container.innerHTML = watchlist.map((movie) => `
      <div class="watch-row">
        <div class="poster-sm ${movie.posterClass || 'poster-drama'}" style="display:flex;align-items:center;justify-content:center;font-size:1.6rem;">${movie.icon || '🎬'}</div>
        <div class="grow">
          <h4>${movie.title}</h4>
          <div class="meta">${movie.genre} · ${movie.year}</div>
        </div>
        <button class="btn btn-ghost btn-sm story-btn" data-title="${movie.title}" data-tag="${(movie.tags && movie.tags[0]) || 'หนังดี'}">📸 Generate Story Card</button>
      </div>`).join('');
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
      poster.className = `poster-lg ${movie.posterClass || 'poster-drama'}`;
      poster.innerHTML = `<span class="icon-lg" style="font-size:4.5rem;">${movie.icon || '🎬'}</span>`;
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
      tags.innerHTML = movie.tags.map((tag) => `<span class="sticker">${tag}</span>`).join('');
    }
    if (writeBtn) {
      writeBtn.addEventListener('click', () => {
        window.location.href = `write-review.html?id=${encodeURIComponent(movie.id)}`;
      });
    }
    if (watchlistBtn) {
      initWatchlistButton(watchlistBtn, movie.id);
    }
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
            <div class="author">🧑‍🚀 ${review.author} · ${new Date(review.createdAt).toLocaleDateString('th-TH')} · 🍿${review.rating}</div>
            <p>${review.text}</p>
            ${review.spoiler ? `
              <div class="spoiler-wrap">
                <p class="spoiler-blur">${review.text}</p>
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

document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
  initAuthNavbar();
  initAuthModal();
  initChangePasswordForm();

  attachUsernameChecker('regUsername', 'modalUsernameStatus');
  attachUsernameChecker('pageRegUsername', 'pageUsernameStatus');

  initMoodPicker();
  initSearchPage();
  initSpoilerShield();
  initWriteReview();
  initWatchlistPage();
  initProfilePage();
  initDetailPage();
});