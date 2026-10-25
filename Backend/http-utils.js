'use strict';
// ตัวช่วยเรื่อง HTTP ที่ server.js และ admin-routes.js ใช้ร่วมกัน

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function sendJSON(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...CORS_HEADERS,
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

// อ่าน body แบบ JSON พร้อมจำกัดขนาด (กันคนส่งไฟล์ยักษ์มาถล่ม server)
// ค่าเริ่มต้น 1 MB — route อัปโหลดรูปโปสเตอร์ส่ง maxBytes ใหญ่กว่านี้เอง
function parseBody(req, { maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        return reject({ status: 413, message: `ข้อมูลที่ส่งมาใหญ่เกินไป (สูงสุด ${Math.round(maxBytes / 1024 / 1024)} MB)` });
      }
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject({ status: 400, message: 'Invalid JSON' });
      }
    });
    req.on('error', reject);
  });
}

// IP จริงของผู้ใช้ (บน Render มี proxy อยู่ข้างหน้า เลยต้องดู x-forwarded-for ก่อน)
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function bearerToken(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

module.exports = { CORS_HEADERS, sendJSON, parseBody, clientIp, bearerToken };
