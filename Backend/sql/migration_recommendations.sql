-- ============================================================================
-- CineSupernova — Migration: ระบบแนะนำหนังเฉพาะบุคคล
-- รันไฟล์นี้ใน Supabase Dashboard > SQL Editor "หนึ่งครั้ง" (รันซ้ำได้ปลอดภัย)
-- ใช้กับฐานข้อมูลที่รัน schema.sql เวอร์ชันเก่าไปแล้ว
-- (ถ้าติดตั้งใหม่จาก schema.sql เวอร์ชันนี้ จะมีตารางเหล่านี้อยู่แล้ว ไม่ต้องรันไฟล์นี้)
-- ============================================================================

-- บันทึกการเปิดดูหน้ารายละเอียดหนัง (สัญญาณรสนิยมแบบเบา)
create table if not exists movie_views (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  movie_id bigint not null references movies(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index if not exists idx_movie_views_user on movie_views(user_id, viewed_at desc);

-- หนังที่ผู้ใช้กด "ไม่สนใจ" (จะไม่ถูกแนะนำอีก)
create table if not exists movie_dismissals (
  user_id bigint not null references users(id) on delete cascade,
  movie_id bigint not null references movies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

-- ช่วยให้ดึงหนังตามผู้กำกับ/นักแสดงที่ผู้ใช้ชอบได้เร็ว
create index if not exists idx_movies_director on movies(director);
create index if not exists idx_movies_star on movies(star);

-- Backend ใช้ service_role key ซึ่งข้าม RLS อยู่แล้ว
-- เปิด RLS ไว้โดยไม่ใส่ policy = anon key เข้าถึงข้อมูลพฤติกรรมของผู้ใช้ไม่ได้เลย
alter table movie_views enable row level security;
alter table movie_dismissals enable row level security;
