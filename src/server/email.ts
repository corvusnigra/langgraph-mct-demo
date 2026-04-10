/**
 * Отправка magic-link письма.
 * Если RESEND_API_KEY не задан — выводим ссылку в консоль (dev-режим).
 */
export async function sendMagicLink(email: string, token: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = `${appUrl}/api/auth/verify?token=${token}`;

  if (!process.env.RESEND_API_KEY) {
    console.log(`[email] magic link для ${email}:\n  ${link}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "noreply@resend.dev",
      to: email,
      subject: "Войти в MCT Assistant",
      html: `
        <p>Нажмите ссылку ниже чтобы войти. Ссылка действительна 15 минут.</p>
        <p><a href="${link}">Войти</a></p>
        <p style="color:#888;font-size:12px">${link}</p>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[email] Resend error ${res.status}: ${body}`);
  }
}
