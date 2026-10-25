/**
 * CineSupernova — ตัวส่งอีเมลผ่าน Gmail (Google Apps Script)
 *
 * ทำไมต้องใช้ตัวนี้: Render แผน Free บล็อกพอร์ต SMTP (25/465/587) เลยส่ง Gmail SMTP ตรงๆ ไม่ได้
 * วิธีนี้ backend จะยิง HTTPS มาที่สคริปต์นี้ แล้วสคริปต์ส่งเมลออกจาก Gmail ของคุณเอง
 * (บัญชี Gmail ธรรมดาส่งได้ประมาณ 100 ฉบับ/วัน)
 *
 * วิธีติดตั้ง (ทำครั้งเดียว):
 *   1. เปิด https://script.google.com > New project แล้ววางโค้ดทั้งไฟล์นี้แทนของเดิม
 *   2. เปลี่ยนค่า SECRET ด้านล่างเป็นรหัสลับยาวๆ (ค่าเดียวกับ GMAIL_SCRIPT_SECRET บน Render)
 *   3. เลือกฟังก์ชัน testSend แล้วกด Run 1 ครั้ง -> กดอนุญาตสิทธิ์ (Review permissions)
 *   4. Deploy > New deployment > Select type: Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   5. คัดลอก Web app URL (ลงท้ายด้วย /exec) ไปใส่ GMAIL_SCRIPT_URL บน Render
 *   ⚠️ ถ้าแก้โค้ดนี้ภายหลัง ต้อง Deploy > Manage deployments > Edit > Version: New version ทุกครั้ง
 */

const SECRET = 'เปลี่ยนเป็นรหัสลับของคุณ-ค่าเดียวกับ-GMAIL_SCRIPT_SECRET';

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!SECRET || data.secret !== SECRET) {
      return json_({ ok: false, error: 'unauthorized (GMAIL_SCRIPT_SECRET ไม่ตรงกับ SECRET ในสคริปต์)' });
    }
    if (!data.to || !data.subject) {
      return json_({ ok: false, error: 'missing to/subject' });
    }
    MailApp.sendEmail({
      to: String(data.to),
      subject: String(data.subject),
      htmlBody: String(data.html || ''),
      body: String(data.text || ''),
      name: String(data.name || 'CineSupernova')
    });
    return json_({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// เปิด URL นี้ใน browser แล้วเห็น {"ok":true,...} = deploy สำเร็จ
function doGet() {
  return json_({ ok: true, service: 'CineSupernova mail relay', remaining: MailApp.getRemainingDailyQuota() });
}

// กด Run ฟังก์ชันนี้ครั้งแรกเพื่อให้ Google ขอสิทธิ์ส่งเมล (จะได้เมลทดสอบ 1 ฉบับ)
function testSend() {
  const me = Session.getActiveUser().getEmail();
  MailApp.sendEmail(me, 'CineSupernova: ทดสอบสคริปต์ส่งเมล', 'ถ้าได้รับเมลนี้ แปลว่าสคริปต์ทำงานได้แล้ว');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
