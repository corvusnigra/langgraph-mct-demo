/**
 * Разбивает текст на чанки с overlap.
 * Порядок приоритетов разбивки: двойные переносы → одиночные переносы → предложения (". ")
 */
export function chunkText(
  text: string,
  chunkSize = 800,
  overlap = 150
): string[] {
  // Нормализуем переносы строк
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Разбиваем на параграфы по двойным переносам
  const paragraphs = normalized.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    // Если параграф сам по себе больше chunkSize — разбиваем дальше
    if (para.length > chunkSize) {
      // Сначала сохраним накопленный current
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      // Разбиваем большой параграф по одиночным переносам
      const lines = para.split(/\n/).map((l) => l.trim()).filter(Boolean);
      let lineBuf = "";
      for (const line of lines) {
        if (line.length > chunkSize) {
          // Разбиваем по предложениям
          if (lineBuf.trim()) {
            chunks.push(lineBuf.trim());
            lineBuf = "";
          }
          const sentences = line.split(/\. /).filter(Boolean);
          let sentBuf = "";
          for (const sent of sentences) {
            const candidate = sentBuf ? sentBuf + ". " + sent : sent;
            if (candidate.length > chunkSize && sentBuf) {
              chunks.push(sentBuf.trim());
              sentBuf = sent;
            } else {
              sentBuf = candidate;
            }
          }
          if (sentBuf.trim()) {
            lineBuf = sentBuf;
          }
        } else {
          const candidate = lineBuf ? lineBuf + "\n" + line : line;
          if (candidate.length > chunkSize && lineBuf) {
            chunks.push(lineBuf.trim());
            lineBuf = line;
          } else {
            lineBuf = candidate;
          }
        }
      }
      if (lineBuf.trim()) {
        chunks.push(lineBuf.trim());
      }
    } else {
      // Параграф умещается в chunkSize
      const candidate = current ? current + "\n\n" + para : para;
      if (candidate.length > chunkSize && current) {
        chunks.push(current.trim());
        current = para;
      } else {
        current = candidate;
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  if (overlap <= 0 || chunks.length <= 1) return chunks;

  // Добавляем overlap: последние `overlap` символов предыдущего чанка в начало следующего
  const result: string[] = [chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    const tail = prev.length > overlap ? prev.slice(prev.length - overlap) : prev;
    result.push(tail + "\n\n" + chunks[i]);
  }
  return result;
}
