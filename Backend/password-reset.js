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
const { sendMail } = require('./mailer');
const { hashPassword } = require('./auth');

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
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function dbError(error) {
  if (error && MISSING_TABLE_CODES.has(error.code)) {
    return { status: 500, message: 'ระบบรีเซ็ตรหัสผ่านยังไม่พร้อมใช้งาน (ผู้ดูแลต้องรัน sql/migration_password_reset.sql ใน Supabase ก่อน)' };
  }
  return { status: 500, message: (error && error.message) || 'เกิดข้อผิดพลาดของฐานข้อมูล' };
}

// ลิงก์ในอีเมลต้องมาจากค่าที่เราตั้งเอง (กัน Host header ปลอม) — ถ้าไม่ได้ตั้งและเป็น production จะไม่ส่ง
function resolveBaseUrl(requestOrigin, env = process.env) {
  const explicit = env.APP_BASE_URL || env.RENDER_EXTERNAL_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (env.NODE_ENV !== 'production' && requestOrigin) return requestOrigin.replace(/\/+$/, '');
  return null;
}

function buildEmail(username, link) {
  const subject = 'รีเซ็ตรหัสผ่าน CineSupernova';
  const text = [
    `สวัสดีคุณ ${username}`,
    '',
    'เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี CineSupernova ของคุณ',
    'คลิกลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์ใช้ได้ 30 นาที และใช้ได้ครั้งเดียว):',
    '',
    link,
    '',
    'ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ'
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#222">
  <h2 style="color:#e5603f;margin:0 0 12px">CineSupernova</h2>
  <p>สวัสดีคุณ <b>${escapeHtml(username)}</b></p>
  <p>เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ คลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์ใช้ได้ 30 นาที และใช้ได้ครั้งเดียว)</p>
  <p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#ff7a59;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">ตั้งรหัสผ่านใหม่</a></p>
  <p style="font-size:13px;color:#666">ถ้าปุ่มกดไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br>${escapeHtml(link)}</p>
  <p style="font-size:13px;color:#666">ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ</p>
</div>`;
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

  // ลิงก์เก่าที่ยังไม่ใช้ → ทำให้ใช้ไม่ได้ (เหลือเฉพาะลิงก์ล่าสุด)
  const { error: invalidateErr } = await supabase.from('password_resets').update({ used_at: new Date(now()).toISOString() }).eq('user_id', user.id).is('used_at', null);
  if (invalidateErr) throw dbError(invalidateErr);

  const token = crypto.randomBytes(32).toString('base64url');
  const { error: insertErr } = await supabase.from('password_resets').insert({
    user_id: user.id,
    token_hash: sha256(token),
    expires_at: new Date(now() + TOKEN_TTL_MS).toISOString()
  });
  if (insertErr) throw dbError(insertErr);

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
      console.warn(`[password-reset] ยังไม่ได้ตั้งค่าบริการส่งอีเมล (BREVO_API_KEY / RESEND_API_KEY) ลิงก์ของ "${user.username}" คือ: ${link}`);
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

/** เช็คว่าลิงก์ยังใช้ได้ไหม (ให้หน้า reset-password แจ้งตั้งแต่เปิดหน้า) */
async function checkResetToken(token, opts = {}) {
  return Boolean(await findValidReset(token, opts.now));
}

async function resetPassword({ token, newPassword } = {}, { now = Date.now } = {}) {
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

  return { message: 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' };
}

module.exports = { requestPasswordReset, resetPassword, checkResetToken, allowIp, resolveBaseUrl, GENERIC_MESSAGE, INVALID_LINK_MESSAGE };
