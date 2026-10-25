# CineSupernova — ระบบ Admin + รีเซ็ตรหัสผ่านทางอีเมล (คู่มือติดตั้ง)

## มีอะไรใหม่

**หน้า Admin (`/admin.html` หรือ `/admin`)** — ล็อกอินด้วยรหัสที่ตั้งไว้ใน Environment บน Render

| แท็บ | ทำอะไรได้ |
|---|---|
| 📊 ภาพรวม | จำนวนหนัง/ผู้ใช้/รีวิว, หนังที่ยังไม่มีรูป (แถบความคืบหน้า), รีวิวล่าสุด, สมาชิกใหม่ |
| 🎬 หนัง & รูป | **ใส่/เปลี่ยน/ลบรูปโปสเตอร์** (คลิก, ลากไฟล์มาวางบนการ์ด, Ctrl+V, วางลิงก์รูป), แก้ข้อมูลหนังทุกช่อง, เพิ่มหนังใหม่, ลบหนัง, กรอง "ยังไม่มีรูป", (ถ้าตั้ง TMDB) ค้นหาโปสเตอร์/เติมรูปอัตโนมัติ |
| 👥 ผู้ใช้ | ค้นหา, ส่งลิงก์รีเซ็ตรหัสให้ผู้ใช้, บังคับออกจากระบบทุกอุปกรณ์, ลบบัญชี |
| 💬 รีวิว | ค้นหาและลบรีวิวที่ไม่เหมาะสม |
| ⚙️ ตั้งค่าระบบ | เช็คว่า Environment / ตาราง / Storage / ระบบเมล ตั้งครบหรือยัง + ปุ่มส่งเมลทดสอบ |

รูปที่อัปโหลดจะถูกย่อในเบราว์เซอร์ (สูงสุด 600×900 เป็น WebP) แล้วเก็บใน **Supabase Storage** (bucket `posters`)
ไม่เก็บบนเครื่อง Render เพราะดิสก์ของ Render แผน Free ล้างทุกครั้งที่ deploy

**ลืมรหัสผ่าน / รีเซ็ตรหัสผ่านทางอีเมล** (ระบบใน `password-reset.js` — เพิ่มตัวส่งเมลผ่าน Gmail และเมลยืนยันหลังเปลี่ยนรหัส)
1. หน้า `login.html` → "ลืมรหัสผ่าน?" → กรอกอีเมล → ระบบส่งลิงก์ (ใช้ได้ 30 นาที ใช้ได้ครั้งเดียว)
2. กดลิงก์ในเมล → หน้า `reset-password.html` → ตั้งรหัสใหม่
3. ระบบเตะออกจากระบบทุกอุปกรณ์ + **ส่งเมลยืนยันว่ารหัสถูกเปลี่ยนแล้ว** (มีปุ่ม "ไม่ใช่ฉัน" ให้รีเซ็ตทันที)
4. เปลี่ยนรหัสจากหน้าโปรไฟล์ก็ได้เมลยืนยันเหมือนกัน + มีปุ่ม "ส่งลิงก์ตั้งรหัสใหม่ไปที่อีเมลของฉัน"

> ⚠️ ทำไมไม่ใช้ Gmail SMTP ตรงๆ: ตั้งแต่ 26 ก.ย. 2025 Render แผน **Free** บล็อกพอร์ต SMTP (25/465/587)
> เลยส่งเมลผ่าน HTTPS แทน — วิธีที่แนะนำคือ Google Apps Script (ส่งจาก Gmail ของเราเอง ฟรี ไม่ต้องมีโดเมน)

---

## ขั้นตอนที่ 1 — รัน SQL ใน Supabase (ทำก่อน push โค้ด)

1. เข้า https://supabase.com/dashboard → เลือกโปรเจกต์ → เมนู **SQL Editor** → **New query**
2. เปิดไฟล์ `Backend/sql/migration_admin_reset.sql` คัดลอกทั้งหมดมาวาง → กด **Run**
3. เช็คผล:
   - **Table Editor → movies** มีคอลัมน์ `poster_url` เพิ่มมา
   - **Table Editor** มีตาราง `password_resets`
   - **Storage** มี bucket ชื่อ `posters` (ติดป้าย Public)

ไฟล์นี้รันซ้ำได้ปลอดภัย ไม่ลบข้อมูลเดิม — **อย่ารัน `seed_movies.sql` ซ้ำ** (มันล้างรีวิว/Watchlist ทั้งหมด)

## ขั้นตอนที่ 2 — ทำตัวส่งเมลด้วย Google Apps Script

1. สร้างรหัสลับไว้หนึ่งอัน (ใช้ทั้งในสคริปต์และบน Render) เช่นรันในเครื่อง:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
2. เปิด https://script.google.com ด้วยบัญชี Gmail ที่จะใช้เป็นผู้ส่ง → **New project** → ตั้งชื่อ เช่น `CineSupernova Mail`
3. ลบโค้ดเดิมใน `Code.gs` ทิ้ง → วางโค้ดทั้งหมดจาก `Backend/email/gmail-relay.gs`
4. แก้บรรทัด `const SECRET = '...'` เป็นรหัสลับจากข้อ 1 → กด 💾 Save
5. ที่แถบด้านบน เลือกฟังก์ชัน **testSend** → กด **Run**
   - จะขึ้น "Authorization required" → **Review permissions** → เลือกบัญชี
   - ขึ้น "Google hasn't verified this app" → กด **Advanced** → **Go to CineSupernova Mail (unsafe)** → **Allow**
     (เป็นสคริปต์ของเราเอง ปลอดภัย)
   - เช็ค Gmail จะได้เมล "ทดสอบสคริปต์ส่งเมล"
6. มุมขวาบน **Deploy → New deployment** → กดรูปเฟือง ⚙️ ข้าง "Select type" → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด **Deploy** → คัดลอก **Web app URL** (ลงท้ายด้วย `/exec`)
7. เปิด URL นั้นในเบราว์เซอร์ ถ้าเห็น `{"ok":true,"service":"CineSupernova mail relay",...}` = ใช้ได้

> ถ้าแก้โค้ดสคริปต์ภายหลัง ต้อง **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** ทุกครั้ง (URL เดิม)
> Gmail ธรรมดาส่งได้ประมาณ 100 ฉบับ/วัน

## ขั้นตอนที่ 3 — ตั้ง Environment บน Render

Render Dashboard → เลือก service → เมนู **Environment** → **Add Environment Variable** แล้วใส่:

| Key | ค่า | หมายเหตุ |
|---|---|---|
| `ADMIN_USERNAME` | `admin` | ชื่อที่ใช้ล็อกอินหน้า admin |
| `ADMIN_PASSWORD` | รหัสยาวๆ ≥ 8 ตัว | **บังคับ** ไม่ตั้ง = หน้า admin ใช้ไม่ได้ |
| `JWT_SECRET` | ค่าสุ่มยาวๆ | ถ้ายังไม่เคยตั้ง ให้ตั้งด้วย |
| `APP_URL` | `https://cine-supernova.vercel.app` | URL หน้าเว็บที่ผู้ใช้เปิด ไม่ต้องมี `/` ท้าย (ถ้าเคยตั้ง `APP_BASE_URL` ไว้แล้ว ใช้ตัวนั้นต่อได้เลย ใช้ได้ทั้งคู่) |
| `GMAIL_SCRIPT_URL` | Web app URL จากขั้นตอนที่ 2 | ลงท้ายด้วย `/exec` |
| `GMAIL_SCRIPT_SECRET` | รหัสลับเดียวกับ `SECRET` ในสคริปต์ | ต้องตรงกันทุกตัวอักษร |
| `MAIL_FROM_NAME` | `CineSupernova` | ไม่บังคับ — ชื่อผู้ส่งในกล่องจดหมาย |
| `PASSWORD_RESET_DEMO` | `false` | ถ้าเคยตั้งเป็น `true` ไว้ ให้เปลี่ยนเป็น `false` บนเว็บจริง |
| `TMDB_API_KEY` | key จาก themoviedb.org | ไม่บังคับ — เปิดปุ่มค้นหา/เติมรูปอัตโนมัติ |

ค่าเดิม (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_EXPIRES_IN`) ไม่ต้องแตะ → กด **Save Changes** (Render จะ deploy ใหม่ให้)

## ขั้นตอนที่ 4 — Push ขึ้น GitHub

```bash
git status            # เช็คว่าไม่มี Backend/.env อยู่ในรายการ
git add .
git commit -m "Add admin dashboard, poster upload, email password reset"
git push
```
Render (และ Vercel ถ้าใช้) จะ deploy ใหม่อัตโนมัติจาก GitHub

## ขั้นตอนที่ 5 — ทดสอบ

1. เปิด `https://<เว็บของคุณ>/admin.html` → ล็อกอินด้วย `ADMIN_USERNAME` / `ADMIN_PASSWORD`
2. แท็บ **⚙️ ตั้งค่าระบบ** → ทุกข้อควรเป็น ✅ (TMDB เป็น ➖ ได้ถ้าไม่ใช้) → กรอกอีเมลตัวเอง → **ส่งเมลทดสอบ**
3. แท็บ **🎬 หนัง & รูป** → เลือก "ยังไม่มีรูป" → ลากรูปโปสเตอร์มาวางบนการ์ด → เปิดหน้าเว็บดูว่ารูปขึ้น
4. ออกจากระบบผู้ใช้ → หน้า login → **ลืมรหัสผ่าน?** → กรอกอีเมลที่สมัครไว้ → เปิดเมล → กดลิงก์ → ตั้งรหัสใหม่ → ได้เมลยืนยัน

## รันในเครื่อง (ไม่บังคับ)

เพิ่มใน `Backend/.env`:
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=รหัสอย่างน้อย8ตัว
APP_URL=http://localhost:3000
```
ถ้าไม่ตั้ง `GMAIL_SCRIPT_URL` ระบบจะไม่ส่งเมลจริง แต่พิมพ์ลิงก์รีเซ็ตไว้ใน terminal ให้กดทดสอบได้เลย

```bash
cd Backend
npm run test:offline   # 62 เทสต์ (admin / ลืมรหัสผ่าน / ส่งเมล / ระบบแนะนำ / ตัวกรองค้นหา) ไม่ต้องต่อ Supabase จริง
```

---

## ทางเลือกอื่น

**Brevo แทน Apps Script** — สมัคร https://www.brevo.com → ยืนยันอีเมลผู้ส่งที่ Senders → สร้าง API key แล้วตั้ง
`BREVO_API_KEY`, `MAIL_FROM_EMAIL` (อีเมลผู้ส่งที่ยืนยันแล้ว) และ**ไม่ต้องตั้ง** `GMAIL_SCRIPT_URL` (ถ้าตั้งไว้ ระบบจะใช้ Gmail ก่อน)
(ถ้าใช้ Gmail เป็นผู้ส่งโดยไม่มีโดเมนของตัวเอง เมลอาจเข้าจดหมายขยะ)

**TMDB (เติมรูปอัตโนมัติ)** — สมัครที่ https://www.themoviedb.org → Settings → API → ขอ API Key (Developer)
แล้วตั้ง `TMDB_API_KEY` (ใช้ได้ทั้ง API Key หรือ API Read Access Token) — ระบบจะใช้ลิงก์รูปจาก TMDB ตรงๆ

## แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| หน้า admin ขึ้น "ระบบ Admin ยังไม่พร้อม" | ยังไม่ได้ตั้ง `ADMIN_PASSWORD` บน Render หรือสั้นกว่า 8 ตัว |
| ล็อกอิน admin ไม่ได้ "ใส่รหัสผิดหลายครั้งเกินไป" | รอ 15 นาที (กันการเดารหัส) |
| อัปโหลดรูปแล้ว error "ยังไม่มีคอลัมน์ poster_url" | ยังไม่ได้รัน `migration_admin_reset.sql` |
| อัปโหลดรูปแล้ว error เรื่อง bucket | รัน migration อีกครั้ง หรือไปที่ Supabase → Storage → New bucket ชื่อ `posters` ติ๊ก Public |
| ⚙️ ระบบส่งอีเมล ขึ้น ⚠️ | ยังไม่ได้ตั้ง `GMAIL_SCRIPT_URL` (หรือ `BREVO_API_KEY` + `MAIL_FROM_EMAIL`) — ตอนนี้ลิงก์รีเซ็ตจะไปโผล่ใน Render → Logs แทน |
| ส่งเมลทดสอบ error "unauthorized" | `GMAIL_SCRIPT_SECRET` บน Render ไม่ตรงกับ `SECRET` ในสคริปต์ |
| error "ไม่ได้ตอบกลับเป็น JSON" | Deploy สคริปต์ไม่ได้ตั้ง Who has access = **Anyone** หรือใช้ URL ผิด (ต้องลงท้าย `/exec`) |
| ลิงก์ในเมลชี้ไป localhost | ตั้ง `APP_URL` บน Render เป็น URL เว็บจริง |
| ลิงก์ในเมลกดแล้ว "ลิงก์นี้ใช้ไม่ได้แล้ว" | เกิน 30 นาที / ใช้ไปแล้ว / มีการขอลิงก์ใหม่หลังจากนั้น (ใช้ได้เฉพาะลิงก์ล่าสุด) |

## ไฟล์ที่เพิ่ม / แก้

- **ใหม่ (Backend):** `admin.js`, `admin-routes.js`, `storage.js`, `tmdb.js`, `http-utils.js`, `rate-limit.js`,
  `email/gmail-relay.gs`, `sql/migration_admin_reset.sql`, `tests/admin-reset.api.test.js`, `tests/mailer.test.js`
- **แก้ (Backend):** `mailer.js` (เพิ่ม Gmail Apps Script + เทมเพลตเมล), `password-reset.js` (เมลยืนยันหลังรีเซ็ต + ให้ admin ส่งลิงก์ได้),
  `auth.js` (เมลแจ้งเตือนเมื่อเปลี่ยนรหัส, เตะออกทุกอุปกรณ์), `server.js`, `movies.js`, `recommendation-service.js`,
  `sql/schema.sql`, `package.json`, `.env.example`, `tests/helpers/fake-supabase.js`
- **ใหม่ (Frontend):** `admin.html`, `admin.js`, `admin.css`
- **แก้ (Frontend):** `app.js` (แสดงรูปโปสเตอร์, ปุ่มส่งลิงก์รีเซ็ตในโปรไฟล์, ลิงก์ "ไม่ใช่ฉัน" จากเมล), `style.css`, `profile.html`, `swagger.json`
- **อื่นๆ:** `render.yaml`, `SETUP.md`, `SETUP-ADMIN-EMAIL.md` (ไฟล์นี้)
