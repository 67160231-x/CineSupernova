-- ============================================================================
-- เพิ่มตาราง password_resets สำหรับระบบ "ลืมรหัสผ่าน"
-- รันใน Supabase > SQL Editor "ครั้งเดียว" ก่อน deploy โค้ดเวอร์ชันที่มีปุ่มลืมรหัสผ่าน
-- (รันซ้ำได้ปลอดภัย เพราะใช้ IF NOT EXISTS และไม่แตะข้อมูลเดิม)
-- ============================================================================

create table if not exists password_resets (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  token_hash text not null unique,        -- เก็บเฉพาะ hash ของ token (ลิงก์จริงอยู่ในอีเมลเท่านั้น)
  expires_at timestamptz not null,
  used_at timestamptz,                    -- มีค่า = ใช้แล้ว / ถูกยกเลิกแล้ว
  created_at timestamptz not null default now()
);

-- เปิด RLS: ไม่มี policy ให้ anon key เลย = เข้าไม่ได้ นอกจาก service_role ของ backend (bypass RLS อยู่แล้ว)
alter table password_resets enable row level security;
