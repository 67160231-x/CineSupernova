'use strict';
// Rate limit แบบง่ายในหน่วยความจำ (พอสำหรับ server ตัวเดียวบน Render)
// ใช้กันการเดารหัส admin และกันการกดขอรีเซ็ตรหัสผ่านรัวๆ จนกล่องเมลคนอื่นเต็ม

function createLimiter({ windowMs, max }) {
  const hits = new Map();

  function prune(now) {
    for (const [key, entry] of hits) {
      if (entry.reset <= now) hits.delete(key);
    }
  }

  return {
    // นับ 1 ครั้ง แล้วบอกว่ายังอยู่ในโควตาไหม
    hit(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        entry = { count: 0, reset: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (hits.size > 5000) prune(now);
      return {
        allowed: entry.count <= max,
        retryAfterSec: Math.max(1, Math.ceil((entry.reset - now) / 1000))
      };
    },
    // ดูเฉยๆ ว่าเกินโควตาหรือยัง (ไม่นับเพิ่ม)
    isBlocked(key) {
      const entry = hits.get(key);
      return Boolean(entry && entry.reset > Date.now() && entry.count >= max);
    },
    reset(key) {
      hits.delete(key);
    },
    clear() {
      hits.clear();
    }
  };
}

module.exports = { createLimiter };
