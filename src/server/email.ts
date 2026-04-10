async function resendSend(payload: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email] (dev) to=${payload.to} subject="${payload.subject}"`);
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
      ...payload,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[email] Resend error ${res.status}: ${body}`);
  }
}

/** Magic-link email. Без RESEND_API_KEY — ссылка в консоль. */
export async function sendMagicLink(email: string, token: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = `${appUrl}/api/auth/verify?token=${token}`;

  if (!process.env.RESEND_API_KEY) {
    console.log(`[email] magic link для ${email}:\n  ${link}`);
    return;
  }

  await resendSend({
    to: email,
    subject: "Войти в MCT Assistant",
    html: `
      <p>Нажмите ссылку ниже чтобы войти. Ссылка действительна 15 минут.</p>
      <p><a href="${link}">Войти</a></p>
      <p style="color:#888;font-size:12px">${link}</p>
    `,
  });
}

/**
 * Follow-up письмо после завершения сессии (Phase 3).
 * Отправляется только если RESEND_API_KEY задан; иначе пишем в консоль.
 */
export async function sendSessionFollowUp(
  email: string,
  opts: {
    exercises: string[];
    homeworkRef?: string;
  }
): Promise<void> {
  const exerciseList =
    opts.exercises.length > 0
      ? `<ul>${opts.exercises.map((e) => `<li>${e}</li>`).join("")}</ul>`
      : "<p>Упражнения не просматривались.</p>";

  const hwSection = opts.homeworkRef
    ? `<p>Согласованное домашнее задание: <strong>${opts.homeworkRef}</strong></p>`
    : "";

  await resendSend({
    to: email,
    subject: "Итоги сессии MCT Assistant",
    html: `
      <h2>Итоги вашей сессии</h2>
      <p>Сегодня вы просматривали следующие упражнения:</p>
      ${exerciseList}
      ${hwSection}
      <p>Если возникнут вопросы — возвращайтесь в любое время.</p>
    `,
  });
}
