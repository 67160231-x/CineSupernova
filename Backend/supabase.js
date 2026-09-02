const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ไม่ได้ตั้งค่า SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน .env');
  console.error('   ดูวิธีตั้งค่าได้ในไฟล์ SETUP.md ที่ root ของโปรเจกต์');
}

// ใช้ service_role key ฝั่ง backend เท่านั้น (bypass RLS ได้) — ห้ามส่งค่านี้ไป frontend เด็ดขาด
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

module.exports = supabase;
