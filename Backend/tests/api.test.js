// หมายเหตุ: เทสต์ชุดนี้ยิงเข้า Supabase จริงตามค่าใน .env (ไม่มี local sqlite fallback แล้ว)
// ต้องตั้งค่า SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ให้ถูกต้องก่อนรัน `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(port);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('GET /api/health returns ok', async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
  });
});

test('GET /api/movies returns list of movies', async () => {
  await withServer(async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/movies?limit=5`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);
    assert.equal(body[0].title.length > 0, true);
    assert.equal(typeof body[0].id, 'number');
  });
});

test('POST /api/reviews adds a review linked to a real movie id', async () => {
  await withServer(async (port) => {
    const moviesRes = await fetch(`http://127.0.0.1:${port}/api/movies?limit=1`);
    const [movie] = await moviesRes.json();

    const res = await fetch(`http://127.0.0.1:${port}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        movieId: movie.id,
        author: 'Tester',
        rating: 5,
        text: 'Great backend test review',
        spoiler: false
      })
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.author, 'Tester');
    assert.equal(body.movieId, movie.id);

    // รีวิวที่เพิ่งสร้าง ต้องโผล่มาตอนดึงรีวิวของหนังเรื่องนั้นด้วย (แก้บั๊ก movieId เทียบชนิดข้อมูลไม่ตรงกัน)
    const reviewsRes = await fetch(`http://127.0.0.1:${port}/api/reviews`);
    const reviews = await reviewsRes.json();
    assert.ok(reviews.some((r) => r.movieId === movie.id && r.author === 'Tester'));
  });
});
