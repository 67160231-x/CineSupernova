const crypto = require('crypto');
const supabase = require('./supabase');

const SECRET_KEY = process.env.JWT_SECRET || 'cinesupernova-secret-key-2026';

// เข้ารหัส Password ด้วย PBKDF2
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHash] = parts;
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

// สร้างและตรวจสอบ JWT Token
function generateToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function decodeAndVerifyJWT(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token รูปแบบไม่ถูกต้อง');
  const [header, body, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', SECRET_KEY).update(`${header}.${body}`).digest('base64url');
  if (signature !== expectedSignature) throw new Error('Token ไม่ถูกต้องหรือถูกแก้ไข');
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

// ใช้ค่านี้กับ .or() ของ PostgREST อย่างปลอดภัย (ครอบด้วย double quote กัน , ในค่า)
function pgQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function mapUserRow(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, email: row.email, createdAt: row.created_at };
}

async function register({ username, email, password }) {
  if (!username || !email || !password) {
    throw { status: 400, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' };
  }
  const passwordHash = hashPassword(password);
  const { data, error } = await supabase
    .from('users')
    .insert({ username, email, password_hash: passwordHash })
    .select('id, username, email, created_at')
    .single();
  if (error) {
    if (error.code === '23505') throw { status: 400, message: 'ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้งานแล้ว' };
    throw { status: 500, message: error.message };
  }
  return mapUserRow(data);
}

async function login({ username, password }) {
  if (!username || !password) {
    throw { status: 400, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
  }
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .or(`username.eq.${pgQuote(username)},email.eq.${pgQuote(username)}`)
    .maybeSingle();
  if (error) throw { status: 500, message: error.message };
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw { status: 401, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }

  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: sessErr } = await supabase.from('sessions').insert({ jti, user_id: user.id, expires_at: expiresAt });
  if (sessErr) throw { status: 500, message: sessErr.message };

  const token = generateToken({ userId: user.id, jti });
  return {
    message: 'เข้าสู่ระบบสำเร็จ',
    token,
    user: { id: user.id, username: user.username, email: user.email }
  };
}

async function verifyToken(token) {
  const payload = decodeAndVerifyJWT(token);
  const { data: session, error } = await supabase.from('sessions').select('*').eq('jti', payload.jti).maybeSingle();
  if (error || !session) throw { status: 401, message: 'Session หมดอายุหรือถูกยกเลิกแล้ว' };
  if (new Date(session.expires_at) < new Date()) throw { status: 401, message: 'Session หมดอายุ' };
  return { userId: payload.userId, jti: payload.jti };
}

async function logout(jti) {
  const { error } = await supabase.from('sessions').delete().eq('jti', jti);
  if (error) throw { status: 500, message: error.message };
}

async function getUserById(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, email, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw { status: 500, message: error.message };
  return mapUserRow(data);
}

async function checkUsername(username) {
  const { data, error } = await supabase.from('users').select('id').ilike('username', username).maybeSingle();
  if (error) throw { status: 500, message: error.message };
  return !data;
}

async function changePassword(userId, { oldPassword, newPassword }) {
  const { data: user, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
  if (error || !user) throw { status: 404, message: 'ไม่พบผู้ใช้' };
  if (!verifyPassword(oldPassword, user.password_hash)) {
    throw { status: 400, message: 'รหัสผ่านเดิมไม่ถูกต้อง' };
  }
  const newHash = hashPassword(newPassword);
  const { error: upErr } = await supabase.from('users').update({ password_hash: newHash }).eq('id', userId);
  if (upErr) throw { status: 500, message: upErr.message };
}

async function listUsers({ page = 1, limit = 10 }) {
  const offset = (page - 1) * limit;
  const { data, error, count } = await supabase
    .from('users')
    .select('id, username, email, created_at', { count: 'exact' })
    .range(offset, offset + limit - 1);
  if (error) throw { status: 500, message: error.message };
  return { users: data || [], total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) };
}

async function updateUser(userId, { username, email }) {
  const patch = {};
  if (username) patch.username = username;
  if (email) patch.email = email;
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('users').update(patch).eq('id', userId);
    if (error) {
      if (error.code === '23505') throw { status: 400, message: 'ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้งานแล้ว' };
      throw { status: 500, message: error.message };
    }
  }
  return getUserById(userId);
}

async function deleteUser(userId) {
  const { error } = await supabase.from('users').delete().eq('id', userId);
  if (error) throw { status: 500, message: error.message };
}

module.exports = {
  register,
  login,
  logout,
  verifyToken,
  getUserById,
  checkUsername,
  changePassword,
  listUsers,
  updateUser,
  deleteUser
};
