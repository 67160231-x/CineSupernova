-- ============================================================================
-- CineSupernova — Migration: ระบบ Admin (รูปโปสเตอร์) + รีเซ็ตรหัสผ่านทางอีเมล
-- รันไฟล์นี้ใน Supabase Dashboard > SQL Editor "หนึ่งครั้ง" (รันซ้ำได้ปลอดภัย ไม่ลบข้อมูลเดิม)
-- ============================================================================

-- 1) คอลัมน์เก็บลิงก์รูปโปสเตอร์ของหนัง (null = ยังไม่มีรูป หน้าเว็บจะใช้สีตามแนว + ไอคอนแทน)
alter table movies add column if not exists poster_url text;

-- 2) ตารางเก็บลิงก์รีเซ็ตรหัสผ่าน (เหมือน migration_password_reset.sql — ถ้ารันไฟล์นั้นไปแล้ว ส่วนนี้จะถูกข้ามเอง)
--    เก็บแค่ "ค่า hash" ของ token (ไม่เก็บ token จริง) ต่อให้ฐานข้อมูลหลุด ก็เอาไปรีเซ็ตรหัสใครไม่ได้
create table if not exists password_resets (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
-- ถ้าเคยสร้างตารางนี้ไว้ก่อนแล้ว (เวอร์ชันเก่า) ให้เติมคอลัมน์ที่ขาดให้ครบ
alter table password_resets add column if not exists used_at timestamptz;
alter table password_resets add column if not exists created_at timestamptz not null default now();
create index if not exists idx_password_resets_user on password_resets(user_id);

-- Backend ใช้ service_role key (ข้าม RLS) — เปิด RLS โดยไม่ใส่ policy = anon key อ่านตารางนี้ไม่ได้เลย
alter table password_resets enable row level security;

-- 3) Storage bucket สำหรับเก็บไฟล์รูปโปสเตอร์ (public = ใครก็เปิดดูรูปได้ แต่อัปโหลดได้เฉพาะ backend)
--    จำกัดไฟล์ละไม่เกิน 5 MB และรับเฉพาะไฟล์รูป
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true;

-- 4) ให้ตัวนับ id ของหนังเดินต่อจาก id ที่มากที่สุด
--    (กันปัญหา "duplicate key" ตอน admin กดเพิ่มหนังใหม่ ถ้าเคย insert หนังแบบระบุ id เอง)
select setval(
  pg_get_serial_sequence('movies', 'id'),
  coalesce((select max(id) from movies), 0) + 1,
  false
);
