'use strict';
// เก็บรูปโปสเตอร์หนังใน Supabase Storage (bucket แบบ public)
// ทำไมไม่เก็บในเครื่อง Render: ดิสก์ของ Render (แผน Free) ล้างทุกครั้งที่ deploy/restart รูปจะหายหมด

const supabase = require('./supabase');

const BUCKET = process.env.POSTER_BUCKET || 'posters';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

let bucketReady = false;

async function ensureBucket() {
  if (bucketReady) return;
  const { data, error } = await supabase.storage.getBucket(BUCKET);
  if (data && !error) {
    bucketReady = true;
    return;
  }
  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: Object.keys(ALLOWED)
  });
  if (createError && !/exist/i.test(createError.message || '')) {
    throw { status: 500, message: `สร้าง Storage bucket "${BUCKET}" ไม่สำเร็จ: ${createError.message}` };
  }
  bucketReady = true;
}

// ตรวจ "ลายเซ็นไฟล์" จริงๆ ไม่เชื่อแค่ชนิดที่ browser บอกมา
function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!match) throw { status: 400, message: 'รูปแบบไฟล์รูปไม่ถูกต้อง (ต้องเป็น data URL แบบ base64)' };
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw { status: 400, message: 'ไฟล์รูปว่างเปล่า' };
  if (buffer.length > MAX_BYTES) throw { status: 413, message: 'ไฟล์รูปใหญ่เกิน 5 MB' };
  const mime = sniffMime(buffer);
  if (!mime || !ALLOWED[mime]) throw { status: 400, message: 'รองรับเฉพาะไฟล์ JPG, PNG, WEBP หรือ GIF' };
  return { buffer, mime };
}

async function uploadPoster(movieId, dataUrl) {
  const { buffer, mime } = decodeDataUrl(dataUrl);
  await ensureBucket();
  // ใส่ timestamp ในชื่อไฟล์ เวลาเปลี่ยนรูปใหม่ browser/CDN จะได้ไม่โชว์รูปเก่าจาก cache
  const objectPath = `movie-${Number(movieId)}-${Date.now()}.${ALLOWED[mime]}`;
  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, buffer, {
    contentType: mime,
    cacheControl: '31536000',
    upsert: true
  });
  if (error) throw { status: 500, message: `อัปโหลดรูปไม่สำเร็จ: ${error.message}` };
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
  return { url: data.publicUrl, path: objectPath, bytes: buffer.length, mime };
}

// ลบไฟล์เก่าออกจาก Storage (เฉพาะไฟล์ที่อยู่ใน bucket ของเราเอง — URL ภายนอกเช่น TMDB ไม่ต้องลบ)
async function removePosterByUrl(url) {
  if (!url) return false;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = String(url).indexOf(marker);
  if (idx === -1) return false;
  const objectPath = decodeURIComponent(String(url).slice(idx + marker.length).split('?')[0]);
  if (!objectPath) return false;
  const { error } = await supabase.storage.from(BUCKET).remove([objectPath]);
  if (error) {
    console.warn(`⚠️ ลบรูปเก่า ${objectPath} ไม่สำเร็จ:`, error.message);
    return false;
  }
  return true;
}

// ใช้ในหน้า "ตั้งค่าระบบ" ของ admin เพื่อเช็คว่า Storage พร้อมใช้งานไหม
async function checkStorage() {
  try {
    await ensureBucket();
    return { ok: true, bucket: BUCKET };
  } catch (error) {
    return { ok: false, bucket: BUCKET, error: error.message || String(error) };
  }
}

module.exports = {
  BUCKET,
  MAX_BYTES,
  uploadPoster,
  removePosterByUrl,
  checkStorage,
  decodeDataUrl,
  _resetForTests() {
    bucketReady = false;
  }
};
