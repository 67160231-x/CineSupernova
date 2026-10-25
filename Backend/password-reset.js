'use strict';

/**
 * ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่
 *
 * flow:  ผู้ใช้กรอกอีเมล → POST /api/forgot-password → สร้าง token สุ่ม (เก็บเฉพาะ hash ใน password_resets)
 *        → ส่งลิงก์ <เว็บ>/reset-password.html?token=... ทางอีเมล (ใช้ได้ 30 นาที ครั้งเดียว)
 *        → ผู้ใช้ตั้งรหัสใหม่ → POST /api/reset-password → เปลี่ยนรหัส + เตะทุกอุปกรณ์ออก (ลบ sessions)
 *
 * ความปลอดภัย: ตอบข้อความเดียวกันเสมอไม่ว่าอีเมลจะมีในระบบหรือไม่ (กันคนไล่เช็คอีเมล),
 *              จำกัดจำนวนครั้งที่ขอ, token ใช้ได้ครั้งเดียวและมีลิงก์ล่าสุดเท่านั้นที่ใช้ได้
 */

const crypto = require('crypto');
const supabase = require('./supabase');
const mailer = require('./mailer');
const { hashPassword } = require('./auth');

// เรียกผ่าน mailer.sendMail ทุกครั้ง (ไม่ผูกฟังก์ชันไว้ตั้งแต่ตอนโหลด) เทสต์จะได้สลับตัวส่งเมลได้
const sendMail = (mail, opts) => mailer.sendMail(mail, opts);

const TOKEN_TTL_MS = 30 * 60 * 1000;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MIN_PASSWORD_LENGTH = 6;
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_REQUESTS = 10;

const GENERIC_MESSAGE = 'ถ้าอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว (ลิงก์ใช้ได้ 30 นาที) ลองเช็คกล่องจดหมายและโฟลเดอร์สแปมด้วยนะ';
const INVALID_LINK_MESSAGE = 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่';
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST200']);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function dbError(error) {
  if (error && MISSING_TABLE_CODES.has(error.code)) {
    return { status: 500, message: 'ระบบรีเซ็ตรหัสผ่านยังไม่พร้อมใช้งาน (ผู้ดูแลต้องรัน sql/migration_password_reset.sql ใน Supabase ก่อน)' };
  }
  return { status: 500, message: (error && error.message) || 'เกิดข้อผิดพลาดของฐานข้อมูล' };
}

// ลิงก์ในอีเมลต้องมาจากค่าที่เราตั้งเอง (กัน Host header ปลอม) — ถ้าไม่ได้ตั้งและเป็น production จะไม่ส่ง
function resolveBaseUrl(requestOrigin, env = process.env) {
  const explicit = env.APP_URL || env.APP_BASE_URL || env.RENDER_EXTERNAL_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (env.NODE_ENV !== 'production' && requestOrigin) return requestOrigin.replace(/\/+$/, '');
  return null;
}

function buildEmail(username, link) {
  const { subject, text, html } = mailer.passwordResetEmail({ username, link, minutes: Math.round(TOKEN_TTL_MS / 60000) });
  return { subject, text, html };
}

// จำกัดจำนวนคำขอต่อ IP (ในหน่วยความจำ พอสำหรับเซิร์ฟเวอร์เดียว)
const ipHits = new Map();
function allowIp(ip, now = Date.now()) {
  const key = ip || 'unknown';
  const fresh = (ipHits.get(key) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (fresh.length >= IP_MAX_REQUESTS) { ipHits.set(key, fresh); return false; }
  fresh.push(now);
  ipHits.set(key, fresh);
  if (ipHits.size > 5000) ipHits.clear();
  return true;
}

// สร้าง token ใหม่ให้ผู้ใช้ (ลิงก์เก่าที่ยังไม่ใช้จะใช้ไม่ได้อีก เหลือเฉพาะลิงก์ล่าสุด)
async function issueToken(userId, now = Date.now) {
  const { error: invalidateErr } = await supabase.from('password_resets').update({ used_at: new Date(now()).toISOString() }).eq('user_id', userId).is('used_at', null);
  if (invalidateErr) throw dbError(invalidateErr);

  const token = crypto.randomBytes(32).toString('base64url');
  const { error: insertErr } = await supabase.from('password_resets').insert({
    user_id: userId,
    token_hash: sha256(token),
    expires_at: new Date(now() + TOKEN_TTL_MS).toISOString()
  });
  if (insertErr) throw dbError(insertErr);
  return token;
}

/**
 * Admin กด "ส่งลิงก์รีเซ็ต" ให้ผู้ใช้ — ไม่ติดลิมิตจำนวนครั้ง และแจ้งผลการส่งเมลกลับไปตรงๆ
 * @returns {{provider:string, delivered:boolean}}
 */
async function sendResetLinkForUser(user, { env = process.env, send = sendMail, now = Date.now } = {}) {
  const token = await issueToken(user.id, now);
  const baseUrl = resolveBaseUrl(null, env) || mailer.appUrl(env);
  const link = `${baseUrl}/reset-password.html?token=${token}`;
  const result = await send({ to: user.email, ...buildEmail(user.username, link) }, { env });
  if (!result || !result.delivered) {
    console.warn(`[password-reset] ยังไม่ได้ตั้งค่าบริการส่งอีเมล ลิงก์ของ "${user.username}" คือ: ${link}`);
  }
  return { provider: (result && result.provider) || 'none', delivered: Boolean(result && result.delivered) };
}

/**
 * ขอลิงก์รีเซ็ตรหัสผ่าน
 * @returns {{message:string, demoResetLink?:string}}
 */
async function requestPasswordReset({ email, requestOrigin } = {}, { env = process.env, send = sendMail, now = Date.now } = {}) {
  const raw = typeof email === 'string' ? email.trim() : '';
  if (!raw) throw { status: 400, message: 'กรุณากรอกอีเมล' };
  if (raw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) throw { status: 400, message: 'รูปแบบอีเมลไม่ถูกต้อง' };

  // ค้นอีเมลแบบไม่สนตัวพิมพ์เล็ก-ใหญ่ (ตอนสมัครอาจพิมพ์ Jay@Gmail.com แต่ตอนลืมรหัสพิมพ์ตัวเล็กหมด) — escape \ % _ กันตีความเป็น wildcard
  const { data: found, error } = await supabase.from('users').select('id, username, email').ilike('email', raw.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(5);
  if (error) throw dbError(error);
  const user = (found || []).find((u) => u.email === raw) || (found || [])[0];
  if (!user) return { message: GENERIC_MESSAGE };

  // จำกัดจำนวนครั้งต่อผู้ใช้ (กันถูกยิงอีเมลรัว)
  const since = new Date(now() - THROTTLE_WINDOW_MS).toISOString();
  const { data: recent, error: recentErr } = await supabase.from('password_resets').select('id').eq('user_id', user.id).gte('created_at', since);
  if (recentErr) throw dbError(recentErr);
  if (recent && recent.length >= MAX_REQUESTS_PER_WINDOW) return { message: GENERIC_MESSAGE };

  const token = await issueToken(user.id, now);

  const baseUrl = resolveBaseUrl(requestOrigin, env);
  if (!baseUrl) {
    console.error('[password-reset] ไม่ได้ตั้ง APP_BASE_URL (และไม่มี RENDER_EXTERNAL_URL) จึงไม่ส่งอีเมล');
    return { message: GENERIC_MESSAGE };
  }
  const link = `${baseUrl}/reset-password.html?token=${token}`;

  try {
    const mail = buildEmail(user.username, link);
    const result = await send({ to: user.email, ...mail }, { env });
    if (!result.delivered) {
      console.warn(`[password-reset] ยังไม่ได้ตั้งค่าบริการส่งอีเมล (GMAIL_SCRIPT_URL / BREVO_API_KEY / RESEND_API_KEY) ลิงก์ของ "${user.username}" คือ: ${link}`);
    }
  } catch (err) {
    console.error('[password-reset] ส่งอีเมลไม่สำเร็จ:', err.message);
  }

  const response = { message: GENERIC_MESSAGE };
  if (env.PASSWORD_RESET_DEMO === 'true') response.demoResetLink = link; // โหมดสาธิตเท่านั้น (ปิดไว้เป็นค่าเริ่มต้น)
  return response;
}

async function findValidReset(token, now = Date.now) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const { data: row, error } = await supabase.from('password_resets').select('id, user_id, expires_at, used_at').eq('token_hash', sha256(token)).maybeSingle();
  if (error) throw dbError(error);
  if (!row || row.used_at || new Date(row.expires_at).getTime() < now()) return null;
  return row;
}

async function notifyChanged(userId, { env, send }) {
  try {
    const { data: user } = await supabase.from('users').select('id, username, email').eq('id', userId).maybeSingle();
    if (!user || !user.email) return;
    const baseUrl = resolveBaseUrl(null, env) || mailer.appUrl(env);
    const mail = mailer.passwordChangedEmail({ to: user.email, username: user.username, via: 'reset', forgotUrl: `${baseUrl}/login.html?forgot=1` });
    await send(mail, { env });
  } catch (err) {
    console.error('[password-reset] ส่งเมลยืนยันการเปลี่ยนรหัสไม่สำเร็จ:', err.message);
  }
}

/** เช็คว่าลิงก์ยังใช้ได้ไหม (ให้หน้า reset-password แจ้งตั้งแต่เปิดหน้า) */
async function checkResetToken(token, opts = {}) {
  return Boolean(await findValidReset(token, opts.now));
}

async function resetPassword({ token, newPassword } = {}, { now = Date.now, env = process.env, send = sendMail } = {}) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw { status: 400, message: `รหัสผ่านใหม่ต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` };
  }
  const row = await findValidReset(token, now);
  if (!row) throw { status: 400, message: INVALID_LINK_MESSAGE };

  // ใช้ token ครั้งเดียว: ถ้าคำขอซ้อนกัน อันที่สองจะไม่ได้แถวกลับมา
  const { data: consumed, error: consumeErr } = await supabase.from('password_resets')
    .update({ used_at: new Date(now()).toISOString() }).eq('id', row.id).is('used_at', null).select('id');
  if (consumeErr) throw dbError(consumeErr);
  if (!consumed || consumed.length !== 1) throw { status: 400, message: INVALID_LINK_MESSAGE };

  const { error: updateErr } = await supabase.from('users').update({ password_hash: hashPassword(newPassword) }).eq('id', row.user_id);
  if (updateErr) throw { status: 500, message: updateErr.message };

  // เตะทุกอุปกรณ์ออก + ทำให้ลิงก์อื่นของผู้ใช้นี้ใช้ไม่ได้
  const { error: sessErr } = await supabase.from('sessions').delete().eq('user_id', row.user_id);
  if (sessErr) throw { status: 500, message: sessErr.message };
  await supabase.from('password_resets').update({ used_at: new Date(now()).toISOString() }).eq('user_id', row.user_id).is('used_at', null);

  // ส่งเมลยืนยันว่ารหัสถูกเปลี่ยนแล้ว (ส่งไม่สำเร็จก็ไม่ทำให้การตั้งรหัสใหม่ล้มเหลว)
  await notifyChanged(row.user_id, { env, send });

  return { message: 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' };
}

module.exports = {
  requestPasswordReset,
  resetPassword,
  checkResetToken,
  sendResetLinkForUser,
  allowIp,
  resolveBaseUrl,
  GENERIC_MESSAGE,
  INVALID_LINK_MESSAGE
};
