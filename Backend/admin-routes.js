'use strict';
// เส้นทาง API ของ Admin ทั้งหมด (/api/admin/...)
// ทุก route ยกเว้น /api/admin/login ต้องแนบ Authorization: Bearer <admin token>

const admin = require('./admin');
const auth = require('./auth');
const mailer = require('./mailer');
const passwordReset = require('./password-reset');
const storage = require('./storage');
const tmdb = require('./tmdb');
const { sendJSON, parseBody, clientIp, bearerToken } = require('./http-utils');
const { createLimiter } = require('./rate-limit');

// เดารหัส admin ผิดได้ 5 ครั้ง / 15 นาที / IP
const loginLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
// กันอีกชั้นแบบรวมทุก IP (เผื่อมีคนปลอม IP มาเรื่อยๆ): ผิดรวมกันได้ไม่เกิน 30 ครั้ง / 15 นาที
const globalLoginLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

const UPLOAD_MAX_BYTES = 8 * 1024 * 1024; // base64 ใหญ่กว่าไฟล์จริง ~33% (ไฟล์จริงจำกัด 5 MB ใน storage.js)

function requireAdmin(req) {
  return admin.verifyToken(bearerToken(req));
}

function statusOverview() {
  const adminState = admin.adminStatus();
  return {
    admin: { ready: adminState.ready, reason: adminState.reason || null, username: admin.adminCredentials().username },
    jwtSecretSet: Boolean(process.env.JWT_SECRET),
    supabaseUrlSet: Boolean(process.env.SUPABASE_URL),
    appUrl: mailer.appUrl(),
    appUrlSource: process.env.APP_URL ? 'APP_URL'
      : (process.env.APP_BASE_URL ? 'APP_BASE_URL' : (process.env.RENDER_EXTERNAL_URL ? 'RENDER_EXTERNAL_URL' : 'default')),
    mailProvider: mailer.getProvider(),
    mailFrom: process.env.MAIL_FROM_EMAIL || process.env.MAIL_FROM || null,
    resetDemoMode: process.env.PASSWORD_RESET_DEMO === 'true',
    gmailScriptSecretSet: Boolean(process.env.GMAIL_SCRIPT_SECRET),
    tmdbEnabled: tmdb.isEnabled(),
    posterBucket: storage.BUCKET
  };
}

// [method, regex, handler(match, ctx)] — handler คืนค่า [status, body]
const routes = [
  ['GET', /^\/api\/admin\/me$/, async (m, { session }) => [200, session]],

  ['GET', /^\/api\/admin\/status$/, async () => {
    const [db, store] = await Promise.all([
      admin.checkDatabase().catch((e) => ({ error: e.message || String(e) })),
      storage.checkStorage()
    ]);
    return [200, { ...statusOverview(), database: db, storage: store }];
  }],

  ['POST', /^\/api\/admin\/test-email$/, async (m, { body }) => {
    const to = String(body.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return [400, { error: 'กรุณาใส่อีเมลผู้รับให้ถูกต้อง' }];
    const result = await mailer.sendMail(mailer.testEmail({ to }));
    const note = result.delivered === false
      ? 'ยังไม่ได้ตั้งค่าระบบส่งเมล (GMAIL_SCRIPT_URL / BREVO_API_KEY) — ยังส่งเมลจริงไม่ได้'
      : `ส่งเมลทดสอบไปที่ ${to} แล้ว (ผ่าน ${result.provider}) ลองเช็คกล่องจดหมาย/จดหมายขยะ`;
    return [200, { message: note, ...result }];
  }],

  ['GET', /^\/api\/admin\/stats$/, async () => [200, await admin.getStats()]],

  // ---------- หนัง ----------
  ['GET', /^\/api\/admin\/movies$/, async (m, { query }) => [200, await admin.listMovies({
    search: query.get('search'),
    poster: query.get('poster'),
    page: query.get('page'),
    limit: query.get('limit')
  })]],
  ['POST', /^\/api\/admin\/movies$/, async (m, { body }) => [201, await admin.createMovie(body)]],
  ['GET', /^\/api\/admin\/movies\/(\d+)$/, async (m) => [200, await admin.getMovie(m[1])]],
  ['PUT', /^\/api\/admin\/movies\/(\d+)$/, async (m, { body }) => [200, await admin.updateMovie(m[1], body)]],
  ['DELETE', /^\/api\/admin\/movies\/(\d+)$/, async (m) => {
    const removed = await admin.deleteMovie(m[1]);
    return [200, { message: `ลบหนัง "${removed.title}" แล้ว`, ...removed }];
  }],

  // อัปโหลดรูป: { image: "data:image/webp;base64,..." } หรือใช้ลิงก์: { url: "https://..." }
  ['POST', /^\/api\/admin\/movies\/(\d+)\/poster$/, async (m, { body }) => [200, await admin.setPoster(m[1], body)], { maxBytes: UPLOAD_MAX_BYTES }],
  ['DELETE', /^\/api\/admin\/movies\/(\d+)\/poster$/, async (m) => [200, await admin.removePoster(m[1])]],

  // ค้นหาโปสเตอร์จาก TMDB (ต้องตั้ง TMDB_API_KEY)
  ['GET', /^\/api\/admin\/movies\/(\d+)\/tmdb$/, async (m, { query }) => {
    const movie = await admin.getMovie(m[1]);
    const results = await tmdb.searchPosters({
      title: query.get('query') || movie.title,
      year: query.has('query') ? query.get('year') : movie.year
    });
    return [200, { items: results }];
  }],

  // เติมรูปอัตโนมัติให้หนังที่ยังไม่มีรูป (เลือกผลแรกจาก TMDB) ทำทีละไม่เกิน 25 เรื่อง กัน request นานเกิน
  ['POST', /^\/api\/admin\/posters\/auto$/, async (m, { body }) => {
    if (!tmdb.isEnabled()) return [503, { error: 'ยังไม่ได้ตั้ง TMDB_API_KEY ใน Environment' }];
    const limit = Math.min(25, Math.max(1, parseInt(body.limit, 10) || 10));
    const movies = await admin.moviesMissingPoster(limit);
    const filled = [];
    const notFound = [];
    for (const movie of movies) {
      try {
        const [first] = await tmdb.searchPosters({ title: movie.title, year: movie.year });
        if (first) {
          await admin.setPoster(movie.id, { url: first.posterUrl });
          filled.push({ id: movie.id, title: movie.title, posterUrl: first.posterUrl });
        } else {
          notFound.push({ id: movie.id, title: movie.title });
        }
      } catch (error) {
        if (error.status === 502 && /401/.test(error.message)) throw error;
        notFound.push({ id: movie.id, title: movie.title, error: error.message });
      }
    }
    return [200, { filled, notFound, checked: movies.length }];
  }],

  // ---------- ผู้ใช้ ----------
  ['GET', /^\/api\/admin\/users$/, async (m, { query }) => [200, await admin.listUsers({
    search: query.get('search'),
    page: query.get('page'),
    limit: query.get('limit')
  })]],
  ['DELETE', /^\/api\/admin\/users\/(\d+)$/, async (m) => {
    const user = await admin.deleteUser(m[1]);
    return [200, { message: `ลบบัญชี ${user.username} แล้ว`, ...user }];
  }],
  ['POST', /^\/api\/admin\/users\/(\d+)\/logout$/, async (m) => {
    const user = await admin.logoutUser(m[1]);
    return [200, { message: `บังคับให้ ${user.username} ออกจากระบบทุกอุปกรณ์แล้ว` }];
  }],
  ['POST', /^\/api\/admin\/users\/(\d+)\/send-reset$/, async (m) => {
    const user = await admin.getUserRow(m[1]);
    const result = await passwordReset.sendResetLinkForUser(user);
    const note = result.delivered
      ? `ส่งลิงก์รีเซ็ตรหัสผ่านไปที่ ${auth.maskEmail(user.email)} แล้ว`
      : 'ยังไม่ได้ตั้งค่าระบบส่งเมล — ลิงก์รีเซ็ตถูกพิมพ์ไว้ใน Logs ของ server';
    return [200, { message: note, provider: result.provider, delivered: result.delivered }];
  }],

  // ---------- รีวิว ----------
  ['GET', /^\/api\/admin\/reviews$/, async (m, { query }) => [200, await admin.listReviews({
    search: query.get('search'),
    movieId: query.get('movieId'),
    page: query.get('page'),
    limit: query.get('limit')
  })]],
  ['DELETE', /^\/api\/admin\/reviews\/(\d+)$/, async (m) => [200, { message: 'ลบรีวิวแล้ว', ...(await admin.deleteReview(m[1])) }]]
];

async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (loginLimiter.isBlocked(ip) || globalLoginLimiter.isBlocked('all')) {
    sendJSON(res, 429, { error: 'ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' });
    return;
  }
  try {
    const body = await parseBody(req);
    const result = admin.login(body);
    loginLimiter.reset(ip);
    sendJSON(res, 200, result);
  } catch (error) {
    if (error.status === 401) {
      loginLimiter.hit(ip);
      globalLoginLimiter.hit('all');
    }
    sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
  }
}

// คืนค่า true ถ้าจัดการ request นี้แล้ว (server.js จะได้ไม่ไปหา route อื่นต่อ)
async function handleAdminRoute(req, res, reqUrl) {
  const { pathname } = reqUrl;
  if (!pathname.startsWith('/api/admin')) return false;

  if (pathname === '/api/admin/login') {
    if (req.method !== 'POST') {
      sendJSON(res, 405, { error: 'Method not allowed' });
      return true;
    }
    await handleLogin(req, res);
    return true;
  }

  let match = null;
  let route = null;
  for (const r of routes) {
    if (r[0] !== req.method) continue;
    match = r[1].exec(pathname);
    if (match) {
      route = r;
      break;
    }
  }
  if (!route) {
    sendJSON(res, 404, { error: 'Admin route not found' });
    return true;
  }

  try {
    const session = requireAdmin(req);
    const options = route[3] || {};
    const body = (req.method === 'POST' || req.method === 'PUT') ? await parseBody(req, options) : {};
    const [status, payload] = await route[2](match, { req, body, query: reqUrl.searchParams, session });
    sendJSON(res, status, payload);
  } catch (error) {
    if (!error.status) console.error('Admin route error:', error);
    sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
  }
  return true;
}

module.exports = {
  handleAdminRoute,
  _loginLimiter: {
    clear() {
      loginLimiter.clear();
      globalLoginLimiter.clear();
    }
  }
};
