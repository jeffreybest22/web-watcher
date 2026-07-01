// Canaux d'alerte. Chaque canal est ignoré si ses variables d'env ne sont pas définies.
import nodemailer from "nodemailer";

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { channel: "telegram", skipped: true };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false }),
  });
  return { channel: "telegram", ok: res.ok, status: res.status };
}

// OpenWA (Pi 5, NestJS) : POST {base}/api/sessions/{sessionId}/messages/send-text
// sessionId = UUID de la session (PAS le nom — piège connu de cette API).
async function notifyWhatsApp(text) {
  const base = process.env.OPENWA_URL; // ex: https://wa.jbjproductionhaiti.com
  const key = process.env.OPENWA_API_KEY;
  const session = process.env.OPENWA_SESSION; // UUID de la session émettrice
  const to = process.env.WA_TO; // ex: 50948104746@c.us
  if (!base || !key || !session || !to) return { channel: "whatsapp", skipped: true };
  const res = await fetch(
    `${base.replace(/\/$/, "")}/api/sessions/${session}/messages/send-text`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify({ chatId: to, text }),
    }
  );
  return { channel: "whatsapp", ok: res.ok, status: res.status };
}

// Email via Resend (prioritaire si RESEND_API_KEY), sinon SMTP.
async function notifyEmailResend(subject, html) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.MAIL_TO;
  if (!key || !to) return null;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "Web Watcher <onboarding@resend.dev>",
      to: to.split(",").map((s) => s.trim()),
      subject,
      html,
    }),
  });
  return { channel: "email(resend)", ok: res.ok, status: res.status };
}

async function notifyEmail(subject, text, html) {
  const viaResend = await notifyEmailResend(subject, html);
  if (viaResend) return viaResend;
  const host = process.env.SMTP_HOST;
  const to = process.env.MAIL_TO;
  if (!host || !to) return { channel: "email", skipped: true };
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
  return { channel: "email", ok: true, id: info.messageId };
}

// Construit le message et envoie sur tous les canaux configurés.
export async function alert(watch, verdict) {
  const title = `🔔 VEILLE: ${watch.label}`;
  const lines = [
    title,
    "",
    `✅ Détecté (confiance ${Math.round(verdict.confidence * 100)}%)`,
    verdict.summary,
  ];
  if (verdict.evidence_url) lines.push(`🔗 ${verdict.evidence_url}`);
  if (verdict.quote) lines.push(`💬 « ${verdict.quote} »`);
  const text = lines.join("\n");
  const html = `<h2>${title}</h2><p><b>Détecté</b> (confiance ${Math.round(
    verdict.confidence * 100
  )}%)</p><p>${verdict.summary}</p>${
    verdict.evidence_url ? `<p>🔗 <a href="${verdict.evidence_url}">${verdict.evidence_url}</a></p>` : ""
  }${verdict.quote ? `<blockquote>${verdict.quote}</blockquote>` : ""}`;

  const results = await Promise.allSettled([
    notifyTelegram(text),
    notifyWhatsApp(text),
    notifyEmail(title, text, html),
  ]);
  return results.map((r) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) }));
}

// Pour `npm run test:notify` : envoie un message de test sur tous les canaux.
export async function testNotify() {
  const text = "✅ Test web-watcher : ce canal d'alerte fonctionne.";
  const results = await Promise.allSettled([
    notifyTelegram(text),
    notifyWhatsApp(text),
    notifyEmail("Test web-watcher", text, `<p>${text}</p>`),
  ]);
  return results.map((r) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) }));
}
