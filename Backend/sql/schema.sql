-- ============================================================================
-- CineSupernova — Supabase (PostgreSQL) schema
-- รันไฟล์นี้ใน Supabase Dashboard > SQL Editor "ครั้งเดียว" ก่อน (จากนั้นค่อยรัน
-- seed_movies.sql เพื่อนำเข้าข้อมูลหนัง 4,000 เรื่อง)
-- ============================================================================

create extension if not exists pgcrypto;

-- ผู้ใช้งาน
create table if not exists users (
  id bigserial primary key,
  username text unique not null,
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- เซสชันล็อกอิน (ผูกกับ JWT ที่ auth.js ออกให้)
create table if not exists sessions (
  jti uuid primary key default gen_random_uuid(),
  user_id bigint not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_sessions_user on sessions(user_id);

-- ภาพยนตร์ (นำเข้าจาก cleaned_movies.json ผ่าน seed_movies.sql)
create table if not exists movies (
  id bigserial primary key,
  title text not null,
  mpaa_rating text,
  genre text,
  year integer,
  score numeric(3,1),
  votes integer,
  director text,
  writer text,
  star text,
  country text,
  budget bigint,
  gross bigint,
  company text,
  runtime integer,
  synopsis text,
  tags text[] not null default '{}',
  poster_class text not null default 'poster-drama',
  icon text not null default '🎬'
);
create index if not exists idx_movies_genre on movies(genre);
create index if not exists idx_movies_score on movies(score desc);
create index if not exists idx_movies_tags on movies using gin(tags);

-- รีวิว (ผูกกับหนังด้วย movie_id แบบ integer และผูกกับผู้ใช้ด้วย user_id ถ้าล็อกอินอยู่)
create table if not exists reviews (
  id bigserial primary key,
  movie_id bigint not null references movies(id) on delete cascade,
  user_id bigint references users(id) on delete set null,
  author text not null,
  rating numeric(3,1) not null default 0,
  text text not null default '',
  spoiler boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_reviews_movie on reviews(movie_id);
create index if not exists idx_reviews_user on reviews(user_id);

-- Watchlist ของแต่ละผู้ใช้ (ของจริง ไม่ใช่ mock)
create table if not exists watchlist_items (
  user_id bigint not null references users(id) on delete cascade,
  movie_id bigint not null references movies(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

-- พฤติกรรมการดูหนัง สำหรับระบบแนะนำหนังเฉพาะบุคคล (ดู migration_recommendations.sql)
create table if not exists movie_views (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  movie_id bigint not null references movies(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index if not exists idx_movie_views_user on movie_views(user_id, viewed_at desc);

create table if not exists movie_dismissals (
  user_id bigint not null references users(id) on delete cascade,
  movie_id bigint not null references movies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

create index if not exists idx_movies_director on movies(director);
create index if not exists idx_movies_star on movies(star);

-- ============================================================================
-- Row Level Security
-- Backend ใช้ service_role key ซึ่ง "bypass RLS โดยอัตโนมัติ" อยู่แล้ว
-- นี่คือ policy สำรองไว้เผื่อมีการเรียกตรงด้วย anon/publishable key ในอนาคต
-- ============================================================================
alter table movies enable row level security;
alter table users enable row level security;
alter table sessions enable row level security;
alter table reviews enable row level security;
alter table watchlist_items enable row level security;
alter table movie_views enable row level security;
alter table movie_dismissals enable row level security;

drop policy if exists "public read movies" on movies;
create policy "public read movies" on movies for select using (true);

drop policy if exists "public read reviews" on reviews;
create policy "public read reviews" on reviews for select using (true);
-- users / sessions / watchlist_items: ไม่มี policy ให้ anon key เลย = เข้าไม่ได้เลยนอกจาก service_role
