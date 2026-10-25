'use strict';
/**
 * ส่งอีเมลผ่าน HTTP API (ไม่ใช้ SMTP เพราะ Render แผน Free บล็อกพอร์ต SMTP 25/465/587 ตั้งแต่ ก.ย. 2025)
 *
 * เลือกผู้ให้บริการจาก Environment ตามลำดับ:
 *   1) Gmail ผ่าน Google Apps Script : GMAIL_SCRIPT_URL (+ GMAIL_SCRIPT_SECRET) — แนะนำ ฟรี ไม่ต้องมีโดเมน
 *                                      ดูวิธีติดตั้งใน Backend/email/gmail-relay.gs
 *   2) Brevo  : BREVO_API_KEY + MAIL_FROM_EMAIL (อีเมลผู้ส่งที่ยืนยันใน Brevo แล้ว)
 *   3) Resend : RESEND_API_KEY (+ MAIL_FROM_EMAIL ถ้ายืนยันโดเมนแล้ว) — ไม่ยืนยันโดเมน = ส่งได้เฉพาะอีเมลเจ้าของบัญชี
 *   4) ไม่ตั้งค่าอะไรเลย → ไม่ส่งจริง (provider = 'none') ผู้เรียกจะ log ลิงก์ไว้ใน console แทน
 */

const APP_NAME = 'CineSupernova';

let transportOverride = null; // ใช้ในเทสต์เท่านั้น

// URL หน้าเว็บที่ใส่ในลิงก์อีเมล — ใช้ค่าจาก Environment เท่านั้น (ห้ามเชื่อ Host header เพราะปลอมได้)
function appUrl(env = process.env) {
  const base = env.APP_URL || env.APP_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`;
  return String(base).trim().replace(/\/+$/, '');
}

function fromEmail(env) {
  return env.MAIL_FROM_EMAIL || env.MAIL_FROM || '';
}

function getProvider(env = process.env) {
  if (transportOverride) return 'test';
  if (env.GMAIL_SCRIPT_URL) return 'gmail-script';
  if (env.BREVO_API_KEY && fromEmail(env)) return 'brevo';
  if (env.RESEND_API_KEY) return 'resend';
  return 'none';
}

async function postJson(fetchImpl, url, headers, body) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'follow'
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (e) { /* ไม่เป็นไร */ }
    throw new Error(`ส่งอีเมลไม่สำเร็จ (HTTP ${res.status}) ${detail}`);
  }
  return res;
}

async function sendMail(mail, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!mail || !mail.to) throw new Error('ไม่มีอีเมลผู้รับ');
  if (transportOverride) return transportOverride(mail);

  const { to, subject, text, html } = mail;
  const name = env.MAIL_FROM_NAME || APP_NAME;
  const provider = getProvider(env);

  if (provider === 'gmail-script') {
    const res = await postJson(fetchImpl, env.GMAIL_SCRIPT_URL, {}, {
      secret: env.GMAIL_SCRIPT_SECRET || '', to, subject, html, text, name
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error('Apps Script ไม่ได้ตอบกลับเป็น JSON — ตรวจว่า Deploy เป็น "Web app", Who has access = "Anyone" และใช้ URL ที่ลงท้ายด้วย /exec');
    }
    if (!data.ok) throw new Error(`Apps Script ส่งเมลไม่สำเร็จ: ${data.error || 'unknown error'}`);
    return { provider, delivered: true, remainingQuota: data.remaining ?? null };
  }

  if (provider === 'brevo') {
    await postJson(fetchImpl, 'https://api.brevo.com/v3/smtp/email', { 'api-key': env.BREVO_API_KEY }, {
      sender: { name, email: fromEmail(env) },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text
    });
    return { provider, delivered: true };
  }

  if (provider === 'resend') {
    const from = fromEmail(env) ? `${name} <${fromEmail(env)}>` : `${name} <onboarding@resend.dev>`;
    await postJson(fetchImpl, 'https://api.resend.com/emails', { Authorization: `Bearer ${env.RESEND_API_KEY}` }, {
      from, to: [to], subject, html, text
    });
    return { provider, delivered: true };
  }

  return { provider: 'none', delivered: false };
}

// ---------------------------------------------------------------------------
// เทมเพลตอีเมล (inline CSS เพราะโปรแกรมอ่านเมลส่วนใหญ่ไม่โหลด CSS ภายนอก)
// ---------------------------------------------------------------------------
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function layout({ heading, bodyHtml, buttonText, buttonUrl, footNote }) {
  const button = buttonUrl ? `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;">
      <tr><td style="border-radius:999px;background:#ff7a59;">
        <a href="${esc(buttonUrl)}" target="_blank" style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:700;color:#1c1730;text-decoration:none;border-radius:999px;">${esc(buttonText)}</a>
      </td></tr>
    </table>
    <p style="margin:0 0 6px;font-size:13px;color:#847c9e;">ถ้ากดปุ่มไม่ได้ ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:</p>
    <p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${esc(buttonUrl)}" style="color:#ff7a59;">${esc(buttonUrl)}</a></p>` : '';
  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f1fa;font-family:'Segoe UI',Tahoma,'Noto Sans Thai',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f1fa;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;">
        <tr><td style="background:#1c1730;padding:22px 28px;">
          <span style="font-size:20px;font-weight:800;color:#ffc857;">🎬 ${APP_NAME}</span>
        </td></tr>
        <tr><td style="padding:30px 28px 24px;color:#3a2e2b;font-size:15px;line-height:1.7;">
          <h1 style="margin:0 0 16px;font-size:22px;color:#1c1730;">${esc(heading)}</h1>
          ${bodyHtml}
          ${button}
          ${footNote ? `<p style="margin:0;font-size:13px;color:#847c9e;">${footNote}</p>` : ''}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#faf8fd;font-size:12px;color:#a09cb0;">
          อีเมลนี้ส่งอัตโนมัติจากระบบ ${APP_NAME} กรุณาอย่าตอบกลับ
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function thaiDateTime(date = new Date()) {
  try {
    return date.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long', timeStyle: 'short' });
  } catch (e) {
    return date.toISOString();
  }
}

function passwordResetEmail({ to, username, link, minutes = 30 }) {
  return {
    to,
    subject: `รีเซ็ตรหัสผ่าน ${APP_NAME}`,
    html: layout({
      heading: 'ตั้งรหัสผ่านใหม่',
      bodyHtml: `
        <p style="margin:0 0 12px;">สวัสดีคุณ <strong>${esc(username)}</strong></p>
        <p style="margin:0;">เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี ${APP_NAME} ของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่
        ลิงก์นี้ใช้ได้ <strong>${minutes} นาที</strong> และใช้ได้ครั้งเดียวเท่านั้น</p>`,
      buttonText: 'ตั้งรหัสผ่านใหม่',
      buttonUrl: link,
      footNote: 'ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ'
    }),
    text: [
      `สวัสดีคุณ ${username}`,
      '',
      `เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี ${APP_NAME} ของคุณ`,
      `เปิดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ ${minutes} นาที และใช้ได้ครั้งเดียว):`,
      '',
      link,
      '',
      'ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ'
    ].join('\n')
  };
}

// เมลยืนยันหลังเปลี่ยนรหัสผ่านสำเร็จ (ทั้งจากลิงก์รีเซ็ต และจากหน้าโปรไฟล์)
function passwordChangedEmail({ to, username, via, forgotUrl }) {
  const how = via === 'reset' ? 'ผ่านลิงก์รีเซ็ตรหัสผ่านทางอีเมล' : 'จากหน้าโปรไฟล์';
  const when = thaiDateTime();
  return {
    to,
    subject: `[${APP_NAME}] รหัสผ่านของคุณถูกเปลี่ยนแล้ว`,
    html: layout({
      heading: 'เปลี่ยนรหัสผ่านสำเร็จ ✅',
      bodyHtml: `
        <p style="margin:0 0 12px;">สวัสดีคุณ <strong>${esc(username)}</strong></p>
        <p style="margin:0 0 12px;">รหัสผ่านของบัญชีคุณถูกเปลี่ยน${how} เมื่อ <strong>${esc(when)}</strong></p>
        <p style="margin:0;">เพื่อความปลอดภัย ระบบได้ออกจากระบบทุกอุปกรณ์ให้แล้ว กรุณาเข้าสู่ระบบใหม่ด้วยรหัสผ่านใหม่</p>`,
      buttonText: 'ไม่ใช่ฉัน — รีเซ็ตรหัสผ่านทันที',
      buttonUrl: forgotUrl,
      footNote: 'ถ้าคุณเป็นคนเปลี่ยนเอง ไม่ต้องทำอะไรเพิ่ม'
    }),
    text: `สวัสดีคุณ ${username}\n\nรหัสผ่านของคุณถูกเปลี่ยน${how} เมื่อ ${when}\nถ้าไม่ใช่คุณ รีเซ็ตรหัสผ่านได้ทันทีที่: ${forgotUrl}`
  };
}

function testEmail({ to }) {
  return {
    to,
    subject: `[${APP_NAME}] ทดสอบระบบส่งอีเมล`,
    html: layout({
      heading: 'ระบบส่งอีเมลใช้งานได้แล้ว 🎉',
      bodyHtml: `<p style="margin:0;">ถ้าคุณเห็นอีเมลนี้ แปลว่าการตั้งค่าส่งเมลบน server ถูกต้องแล้ว (ส่งเมื่อ ${esc(thaiDateTime())})</p>`
    }),
    text: `ระบบส่งอีเมลของ ${APP_NAME} ใช้งานได้แล้ว`
  };
}

module.exports = {
  sendMail,
  getProvider,
  appUrl,
  passwordResetEmail,
  passwordChangedEmail,
  testEmail,
  setTransportForTests(fn) {
    transportOverride = fn;
  }
};
