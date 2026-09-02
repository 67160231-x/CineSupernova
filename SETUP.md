# CineSupernova — คู่มือติดตั้ง (หลังแก้ไข)

โปรเจกต์นี้ถูกปรับให้ต่อกับ **Supabase project เดิม** ที่มีอยู่ใน `.env` แล้ว
(`yyioxqafbsetsxuopouf.supabase.co`) และย้ายข้อมูลทั้งหมด (users, sessions, movies, reviews, watchlist)
ไปอยู่บน Supabase แทน SQLite ในเครื่อง

## ขั้นตอนที่ 1 — สร้างตารางใน Supabase

1. เข้า https://supabase.com/dashboard เลือกโปรเจกต์ `yyioxqafbsetsxuopouf`
2. ไปที่เมนู **SQL Editor** > New query
3. คัดลอกเนื้อหาทั้งหมดจาก `Backend/sql/schema.sql` มาวาง แล้วกด Run
   (สร้างตาราง users / sessions / movies / reviews / watchlist_items + RLS)

## ขั้นตอนที่ 2 — นำเข้าข้อมูลหนัง 4,000 เรื่อง

1. ใน SQL Editor เดิม เปิด query ใหม่อีกอัน
2. คัดลอกเนื้อหาทั้งหมดจาก `Backend/sql/seed_movies.sql` มาวาง แล้วกด Run
   - ไฟล์นี้ประมวลผลจาก `Backend/data/cleaned_movies.json` มาแล้ว พร้อมคำนวณ
     `poster_class` / `icon` / `tags` (vibe ภาษาไทย) จาก genre จริงของแต่ละเรื่องให้ถูกต้อง
   - รันซ้ำได้ปลอดภัย (มี `TRUNCATE` อยู่ต้นไฟล์ จะล้างข้อมูลหนัง/รีวิว/watchlist เดิมก่อนนำเข้าใหม่
     **ระวัง: อย่ารันซ้ำถ้ามีรีวิวจริงของผู้ใช้ที่อยากเก็บไว้แล้ว**)
   - ใช้เวลารันสักครู่เพราะมี ~4,000 แถว แบ่งเป็นชุดละ 400 แถว

## ขั้นตอนที่ 3 — เอา Service Role Key มาใส่ .env

1. ใน Supabase Dashboard ไปที่ **Project Settings > API**
2. คัดลอกค่า **service_role key** (ไม่ใช่ anon/publishable key)
   ⚠️ คีย์นี้มีสิทธิ์เต็ม ห้าม commit ขึ้น git และห้ามส่งไปฝั่ง frontend เด็ดขาด — ใช้ backend เท่านั้น
3. เปิด `Backend/.env` แล้ววางค่าแทนบรรทัด `SUPABASE_SERVICE_ROLE_KEY=...`

```
SUPABASE_URL=https://yyioxqafbsetsxuopouf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<วางค่าจริงตรงนี้>
PORT=3000
JWT_SECRET=<เปลี่ยนเป็นค่าสุ่มยาวๆ ของตัวเอง>
JWT_EXPIRES_IN=7d
```

## ขั้นตอนที่ 4 — รันในเครื่อง

```bash
cd Backend
npm install
npm start
```

เปิด http://localhost:3000 — Frontend จะถูก serve จาก backend ตัวเดียวกัน (ไม่ต้องรันแยก)

ทดสอบเร็วๆ:
```bash
curl http://localhost:3000/api/health
curl "http://localhost:3000/api/movies?limit=3"
```

## ขั้นตอนที่ 5 — Deploy ขึ้น Render (หรือ host อื่น)

ใน Render Dashboard > Environment ของ service เดิม ให้ตั้งค่า environment variables ต่อไปนี้
(ต้องตั้งที่นี่ด้วย ไม่ใช่แค่ในไฟล์ `.env` เพราะ `.env` จะไม่ถูก commit ขึ้น git):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`

แล้ว redeploy — ข้อมูล users/reviews/watchlist จะไม่หายอีกต่อไปเวลา redeploy/restart แล้ว
เพราะย้ายจาก SQLite (ephemeral) มาอยู่บน Supabase (persistent) ทั้งหมด

---

# สรุปสิ่งที่แก้ไขทั้งหมด

## ฐานข้อมูล / Backend
1. **Supabase ไม่เคยทำงานจริง** — ชื่อ env var ใน `.env` (`NEXT_PUBLIC_SUPABASE_URL`) ไม่ตรงกับที่โค้ดอ่าน
   (`SUPABASE_URL`) และไฟล์ `.env` ไม่เคยถูกโหลดเลยเพราะไม่มี `require('dotenv').config()` — แก้ทั้งสองจุด
2. ย้าย **users / sessions / movies / reviews / watchlist** ทั้งหมดไปอยู่บน Supabase (Postgres) แทน
   SQLite ที่หายทุกครั้ง deploy ใหม่บน Render free tier
3. เพิ่มตาราง `watchlist_items` จริง — เดิม endpoint `/api/watchlist` เป็นของปลอม (คืนหนัง 2 เรื่องแรก
   ให้ทุกคนเหมือนกันหมด ไม่ผูกกับผู้ใช้เลย)
4. เพิ่มคอลัมน์ `user_id` ในตาราง `reviews` — ทำให้หน้า Profile คำนวณ Level/XP/Badge จากรีวิวที่ใช่ของ
   ผู้ใช้คนนั้นจริงๆ (เดิมจับคู่จากชื่อ author แบบ string ซึ่งเดายากและ badge "เซียนไซไฟ" ปลดล็อกไม่ได้เลย)
5. ตัดแพ็กเกจที่ไม่ได้ใช้จริงออกจาก `package.json` (sqlite3, bcryptjs, jsonwebtoken, cors)

## บั๊กที่กระทบผู้ใช้โดยตรง
6. **โปสเตอร์/ไอคอนหนังผิดเกือบทุกเรื่อง** — โค้ดเดิม match genre เป็นคำไทย แต่ข้อมูลจริงเป็นภาษาอังกฤษ
   แก้โดยคำนวณ `poster_class`/`icon` ที่ถูกต้องตอนนำเข้าข้อมูล (ดู `seed_movies.sql`) และเพิ่ม CSS
   สีใหม่ 5 แนว (Action, Adventure, Animation, Crime, Fantasy) ที่เดิมไม่มี
7. **ตัวเลข ★ บนการ์ดหนังผิด** — เดิมโชว์เรต MPAA (เช่น "R") แทนคะแนนหนัง แก้เป็น `score` จริง
8. **ปุ่ม Vibe ในหน้า Search ใช้ไม่ได้เลยสักปุ่ม** — แท็กมีแค่ในข้อมูลตัวอย่างเก่า ไม่มีในหนังจริง 4,000
   เรื่อง แก้โดยคำนวณแท็กที่ตรงกับ 6 vibe เดิมจาก genre จริงของแต่ละเรื่อง
9. **รีวิวไม่เชื่อมกับหนังที่ถูกต้อง** — ต้นตอจริงคือปุ่ม "เขียนรีวิว" ในหน้า detail ไม่มี id ผูกไว้เลยและใช้
   `onclick` แบบ static ที่ไม่ส่ง movie id ไปด้วย ทำให้ทุกรีวิวหลุด id เสมอ (เดิมเลยต้อง fallback เป็น id
   ปลอม `'signal-from-space'`) แก้โดยผูกปุ่มกับ JS ให้ส่ง id ไปจริง และเทียบ id แบบ Number() ให้ตรงชนิด
   ข้อมูลทั้งสองฝั่ง
10. **ปุ่ม "+ เพิ่มลง Watchlist" กดแล้วไม่มีอะไรเกิดขึ้น** — ไม่เคยมี event listener ผูกไว้เลย แก้ให้เรียก
    API watchlist จริง พร้อม toggle เพิ่ม/ลบ
11. **Mood Picker ไม่ได้เลือกหนังตามอารมณ์จริง** — เดิมแค่หมุน index ใน array ตามเลข mood แก้ให้กรอง
    genre ที่เข้ากับ mood จริงผ่าน backend (`/api/movies?mood=N`)
12. **ตัวเลขคะแนนย่อย 3 ช่องในหน้า detail เป็นค่าปลอมตายตัวทุกเรื่อง** (4.9 / 4.2 / 3.8) — แก้เป็นข้อมูล
    จริงของหนังเรื่องนั้น: ปีที่ฉาย, ความยาว (นาที), จำนวนโหวต
13. เพิ่ม default movieId guard ในหน้าเขียนรีวิว — ถ้าเข้าหน้านี้โดยไม่มี `?id=` จะแจ้งเตือนแทนที่จะ
    ส่งรีวิวลอยๆ ไม่ผูกกับหนังเรื่องไหน

## ยังไม่ได้แตะ (นอกขอบเขตครั้งนี้ ถ้าต้องการให้ทำต่อบอกได้เลย)
- หน้า Search ยังโหลดหนังทั้ง 4,000 เรื่องมา filter ฝั่ง client (ใช้งานได้ปกติ แต่ยังไม่ได้ทำ
  pagination/search ฝั่ง server เพื่อความเร็วที่ดีขึ้น)
- ไฟล์ `csv/movies.csv` เป็นไฟล์ต้นทางดิบที่ไม่ได้ถูกใช้ในโค้ดจริง (ใช้ `cleaned_movies.json` เท่านั้น)
  ทิ้งไว้เฉยๆ ไม่กระทบการทำงาน
