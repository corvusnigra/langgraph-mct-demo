/**
 * Читает тело ответа fetch и парсит JSON. Пустое тело и HTML-ошибки не ломают приложение.
 */
export async function parseApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      `Пустой ответ сервера (HTTP ${res.status}). Часто это таймаут edge/serverless или обрыв соединения.`
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const preview = trimmed.slice(0, 160).replace(/\s+/g, " ");
    throw new Error(
      `Ответ не JSON (HTTP ${res.status}). ${preview || "…"}`
    );
  }
}
