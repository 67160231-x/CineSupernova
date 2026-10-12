'use strict';

/**
 * ส่งอีเมลผ่าน HTTP API (ไม่ใช้ SMTP เพราะ Render แพ็กเกจฟรีบล็อกพอร์ต SMTP)
 * เลือกผู้ให้บริการจาก env ตามลำดับ:
 *   1) Brevo  : BREVO_API_KEY  + MAIL_FROM_EMAIL (อีเมลที่ยืนยันเป็น Sender ใน Brevo แล้ว) — ส่งหาใครก็ได้
 *   2) Resend : RESEND_API_KEY (+ MAIL_FROM_EMAIL ถ้ายืนยันโดเมนแล้ว) — ถ้าไม่ยืนยันโดเมน ส่งได้เฉพาะอีเมลเจ้าของบัญชี
 *   3) ไม่ตั้งค่าอะไรเลย → ไม่ส่งอีเมลจริง (provider = 'none') ผู้เรียกจะ log ลิงก์ไว้ใน console แทน
 */

async function postJson(fetchImpl, url, headers, body) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch (e) { /* ไม่เป็นไร */ }
    throw new Error(`ส่งอีเมลไม่สำเร็จ (HTTP ${res.status}) ${detail}`);
  }
  return res;
}

async function sendMail({ to, subject, text, html }, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const fromEmail = env.MAIL_FROM_EMAIL;
  const fromName = env.MAIL_FROM_NAME || 'CineSupernova';

  if (env.BREVO_API_KEY && fromEmail) {
    await postJson(fetchImpl, 'https://api.brevo.com/v3/smtp/email', { 'api-key': env.BREVO_API_KEY }, {
      sender: { name: fromName, email: fromEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text
    });
    return { provider: 'brevo', delivered: true };
  }

  if (env.RESEND_API_KEY) {
    const from = fromEmail ? `${fromName} <${fromEmail}>` : `${fromName} <onboarding@resend.dev>`;
    await postJson(fetchImpl, 'https://api.resend.com/emails', { Authorization: `Bearer ${env.RESEND_API_KEY}` }, {
      from, to: [to], subject, html, text
    });
    return { provider: 'resend', delivered: true };
  }

  return { provider: 'none', delivered: false };
}

module.exports = { sendMail };
