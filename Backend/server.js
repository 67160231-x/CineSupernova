require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { initDb, addReview, getReviews, getWatchlist, addToWatchlist, removeFromWatchlist } = require('./database');
const movieService = require('./movies');
const auth = require('./auth');

const frontendDir = path.resolve(__dirname, '../Frontend/CineSupernova-main');

function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 
      'Content-Type': getContentType(filePath),
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  });
}

async function requireAuth(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const err = new Error('ต้องแนบ Authorization: Bearer <token>');
    err.status = 401;
    throw err;
  }
  return auth.verifyToken(token);
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      res.end();
      return;
    }

    const reqUrl = new URL(req.url, 'http://localhost');
    const { pathname } = reqUrl;

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJSON(res, 200, { status: 'ok', message: 'CineSupernova backend is running' });
      return;
    }
    if (req.method === 'GET' && pathname === '/docs') {
      serveStaticFile(res, path.join(frontendDir, 'docs.html'));
      return;
    }

    // AUTHENTICATION ROUTES
    if (req.method === 'POST' && pathname === '/api/register') {
      try {
        const body = await parseBody(req);
        const user = await auth.register(body);
        sendJSON(res, 201, user);
      } catch (error) {
        sendJSON(res, error.status || 400, { error: error.message || 'Bad request' });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/login') {
      try {
        const body = await parseBody(req);
        const result = await auth.login(body);
        sendJSON(res, 200, result);
      } catch (error) {
        sendJSON(res, error.status || 400, { error: error.message || 'Bad request' });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      try {
        const { jti } = await requireAuth(req);
        await auth.logout(jti);
        sendJSON(res, 200, { message: 'ออกจากระบบสำเร็จ' });
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/change-password') {
      try {
        const { userId } = await requireAuth(req);
        const body = await parseBody(req);
        await auth.changePassword(userId, body);
        sendJSON(res, 200, { message: 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบใหม่' });
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
      }
      return;
    }

    // USER MANAGEMENT
    if (req.method === 'GET' && pathname === '/api/me') {
      try {
        const { userId } = await requireAuth(req);
        const user = await auth.getUserById(userId);
        if (!user) return sendJSON(res, 404, { error: 'ไม่พบผู้ใช้' });
        sendJSON(res, 200, user);
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
      }
      return;
    }

    const checkUsernameMatch = pathname.match(/^\/api\/check-username\/([^/]+)$/);
    if (req.method === 'GET' && checkUsernameMatch) {
      try {
        const name = decodeURIComponent(checkUsernameMatch[1]);
        const available = await auth.checkUsername(name);
        sendJSON(res, 200, { username: name, available, message: available ? 'ชื่อผู้ใช้นี้สามารถใช้งานได้' : 'ชื่อผู้ใช้นี้ถูกใช้งานแล้ว' });
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/users') {
      try {
        await requireAuth(req);
        const page = Math.max(1, parseInt(reqUrl.searchParams.get('page')) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(reqUrl.searchParams.get('limit')) || 10));
        const result = await auth.listUsers({ page, limit });
        sendJSON(res, 200, result);
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
      }
      return;
    }

    const userIdMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userIdMatch) {
      const targetId = Number(userIdMatch[1]);

      if (req.method === 'GET') {
        try {
          await requireAuth(req);
          const user = await auth.getUserById(targetId);
          if (!user) return sendJSON(res, 404, { error: 'ไม่พบผู้ใช้' });
          sendJSON(res, 200, user);
        } catch (error) {
          sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
        }
        return;
      }

      if (req.method === 'PUT') {
        try {
          const { userId } = await requireAuth(req);
          if (userId !== targetId) {
            sendJSON(res, 403, { error: 'แก้ไขได้เฉพาะข้อมูลของตัวเองเท่านั้น' });
            return;
          }
          const body = await parseBody(req);
          const updated = await auth.updateUser(targetId, body);
          sendJSON(res, 200, updated);
        } catch (error) {
          sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
        }
        return;
      }

      if (req.method === 'DELETE') {
        try {
          const { userId } = await requireAuth(req);
          if (userId !== targetId) {
            sendJSON(res, 403, { error: 'ลบได้เฉพาะบัญชีของตัวเองเท่านั้น' });
            return;
          }
          await auth.deleteUser(targetId);
          sendJSON(res, 200, { message: 'ลบบัญชีผู้ใช้สำเร็จ' });
        } catch (error) {
          sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
        }
        return;
      }
    }

    // MOVIES / REVIEWS / WATCHLIST / PROFILE
    if (req.method === 'GET' && pathname === '/api/movies') {
      try {
        const filters = {
          search: reqUrl.searchParams.get('search'),
          genre: reqUrl.searchParams.get('genre'),
          tag: reqUrl.searchParams.get('tag'),
          mood: reqUrl.searchParams.get('mood'),
          limit: reqUrl.searchParams.get('limit')
        };
        const movies = await movieService.getAllMovies(filters);
        sendJSON(res, 200, movies);
      } catch (error) {
        sendJSON(res, 500, { error: error.message || 'Database error' });
      }
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/movies/')) {
      const movieId = pathname.split('/').pop();
      try {
        const movie = await movieService.getMovieById(movieId);
        if (!movie) {
          sendJSON(res, 404, { error: 'Movie not found' });
          return;
        }
        sendJSON(res, 200, movie);
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'Database error' });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/reviews') {
      try {
        const movieId = reqUrl.searchParams.get('movieId');
        const reviews = await getReviews(movieId ? { movieId } : {});
        sendJSON(res, 200, reviews);
      } catch (error) {
        sendJSON(res, 500, { error: error.message || 'Database error' });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/reviews') {
      try {
        const body = await parseBody(req);
        let userId = null;
        let author = body.author || 'นักวิจารณ์';
        // ถ้ามีการแนบ token มาด้วยก็ผูกรีวิวกับ user จริง (ไม่บังคับ ยังรีวิวแบบ guest ได้)
        try {
          const authResult = await requireAuth(req);
          userId = authResult.userId;
          const user = await auth.getUserById(userId);
          if (user) author = user.username;
        } catch (authError) {
          // ไม่ได้ล็อกอิน — รีวิวแบบ guest ต่อไปได้ตามปกติ
        }
        const review = await addReview({
          movieId: body.movieId,
          userId,
          author,
          rating: Number(body.rating || 0),
          text: body.text || '',
          spoiler: Boolean(body.spoiler)
        });
        sendJSON(res, 201, review);
      } catch (error) {
        sendJSON(res, error.status || 400, { error: error.message || 'Bad request' });
      }
      return;
    }

    // WATCHLIST (ของจริงต่อผู้ใช้ ต้องล็อกอิน)
    if (req.method === 'GET' && pathname === '/api/watchlist') {
      try {
        const { userId } = await requireAuth(req);
        const list = await getWatchlist(userId);
        sendJSON(res, 200, list);
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/watchlist') {
      try {
        const { userId } = await requireAuth(req);
        const body = await parseBody(req);
        await addToWatchlist(userId, body.movieId);
        sendJSON(res, 201, { message: 'เพิ่มลง Watchlist แล้ว' });
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
      }
      return;
    }

    const watchlistItemMatch = pathname.match(/^\/api\/watchlist\/([^/]+)$/);
    if (req.method === 'DELETE' && watchlistItemMatch) {
      try {
        const { userId } = await requireAuth(req);
        await removeFromWatchlist(userId, watchlistItemMatch[1]);
        sendJSON(res, 200, { message: 'ลบออกจาก Watchlist แล้ว' });
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
      }
      return;
    }

    // เดิม endpoint นี้ไม่เช็ค token และคืนค่าชื่อ/ข้อมูลที่ hardcode ไว้ตายตัว
    // ทำให้หน้า Profile ของทุกคนที่ login เข้ามาเห็นชื่อ 'น้องเจย์' เหมือนกันหมด
    // แก้ให้ต้องแนบ token (requireAuth) แล้วดึงข้อมูลผู้ใช้จริงจาก DB มาใช้แทน
    //
    // เดิม level/xp/badges ถูก mock ไว้เป็นค่าคงที่ (level: 12, xp: 680, badges ปลดล็อกหมด)
    // ทำให้สมาชิกใหม่ที่พึ่งสมัครเห็น Lv.12 ทันที ทั้งที่ยังไม่เคยทำอะไรเลย
    // ตอนนี้ตาราง reviews มีคอลัมน์ user_id ผูกโดยตรงแล้ว (Supabase) เลยคำนวณ XP/Level/Badge
    // จากรีวิวจริงของ user คนนั้น และเช็ค genre จริงของหนังที่รีวิวเพื่อปลด badge "เซียนไซไฟ"
    if (req.method === 'GET' && pathname === '/api/profile') {
      try {
        const { userId } = await requireAuth(req);
        const user = await auth.getUserById(userId);
        if (!user) return sendJSON(res, 404, { error: 'ไม่พบผู้ใช้' });

        const myReviews = await getReviews({ userId });

        const XP_PER_REVIEW = 50;
        const XP_PER_LEVEL = 100;

        const xp = myReviews.length * XP_PER_REVIEW;
        const level = Math.floor(xp / XP_PER_LEVEL) + 1;
        const xpIntoCurrentLevel = xp % XP_PER_LEVEL;

        const hasRoast = myReviews.some((r) => Number(r.rating) <= 2);

        let hasScifi = false;
        if (myReviews.length > 0) {
          const allMovies = await movieService.getAllMovies();
          const movieById = new Map(allMovies.map((m) => [m.id, m]));
          hasScifi = myReviews.some((r) => {
            const movie = movieById.get(r.movieId);
            return movie && movie.genre === 'Sci-Fi';
          });
        }

        sendJSON(res, 200, {
          name: user.username,
          email: user.email,
          level,
          xp: xpIntoCurrentLevel,
          nextLevelXp: XP_PER_LEVEL,
          reviewCount: myReviews.length,
          badges: [
            { id: 'review-first', name: 'รีวิวแรก', unlocked: myReviews.length >= 1 },
            { id: 'roast', name: 'สาย Roast', unlocked: hasRoast },
            { id: 'scifi', name: 'เซียนไซไฟ', unlocked: hasScifi },
            { id: 'sad', name: 'ตับพัง x10', unlocked: myReviews.length >= 10 }
          ]
        });
      } catch (error) {
        sendJSON(res, error.status || 500, { error: error.message || 'เกิดข้อผิดพลาด' });
      }
      return;
    }

    if (req.method === 'GET') {
      const normalizedPath = pathname === '/' ? '/index.html' : pathname;
      const filePath = path.join(frontendDir, normalizedPath);
      if (!filePath.startsWith(frontendDir)) {
        sendJSON(res, 403, { error: 'Forbidden' });
        return;
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveStaticFile(res, filePath);
        return;
      }
    }

    sendJSON(res, 404, { error: 'Route not found' });
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  initDb().then(() => {
    const server = createServer();
    server.listen(port, () => {
      console.log(`CineSupernova backend running on port ${port}`);
    });
  }).catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });
}

module.exports = { createServer };