import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { MCT_REFERENCE, type MctReferenceChunk } from "./mct-reference";
import { semanticSearch } from "./embeddings/vector-store";

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "it", "they",
  "them", "their", "this", "that", "these", "those", "what", "which",
  "who", "whom", "when", "where", "why", "how", "all", "any", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "not",
  "only", "same", "so", "than", "too", "very", "just", "but", "and",
  "or", "if", "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "up", "about", "into", "through", "during", "before", "after", "above",
  "below", "between", "out", "off", "over", "under", "again", "then",
  "once", "here", "there", "am", "also", "as",
  // Russian (короткие стоп-слова для смешанных запросов)
  "и", "в", "на", "с", "по", "к", "о", "об", "от", "за", "из", "для", "как",
  "а", "но", "или", "то", "не", "ни", "что", "это", "мы", "вы", "он", "она",
  "меня", "мне", "мой", "моя", "мои", "же", "ли", "бы",
]);

/** Минимальная доля слов запроса, которые должны присутствовать в chunk-е (0..1). */
const SCORE_RATIO_THRESHOLD = 0.4;
/** Абсолютный минимум совпадений для однословных / двусловных запросов. */
const SCORE_ABS_MIN = 1;

function keywordScore(query: string, words: Set<string>, chunk: MctReferenceChunk): number {
  const text = (chunk.title + " " + chunk.content).toLowerCase();
  let n = 0;
  for (const w of words) {
    if (text.includes(w)) n += 1;
  }
  return n;
}

export const lookupMctReference = tool(
  async ({ query }: { query: string }) => {
    console.log(`[TOOL] lookup_mct_reference(query='${query.slice(0, 120)}...')`);

    // Попытка семантического поиска
    const semResults = await semanticSearch(query, { limit: 2, sourceType: "all" });
    if (semResults && semResults.length > 0) {
      console.log(`[TOOL] lookup_mct_reference → semantic mode, ${semResults.length} hits`);
      return semResults.map((r) => `### Источник\n${r.content}`).join("\n\n---\n\n");
    }

    // fallback → keyword search
    const queryWords = new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w && !STOP_WORDS.has(w))
    );
    const querySize = Math.max(queryWords.size, 1);

    const scored = MCT_REFERENCE.map((chunk) => ({
      chunk,
      score: keywordScore(query, queryWords, chunk),
    }));

    const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    for (const { chunk, score } of hits) {
      const ratio = score / querySize;
      const ok = ratio >= SCORE_RATIO_THRESHOLD ? "✅" : "❌";
      console.log(`  ${ok} [${score}/${querySize}=${ratio.toFixed(2)}] ${chunk.title}`);
    }

    const relevant = scored
      .filter((x) => x.score >= SCORE_ABS_MIN && x.score / querySize >= SCORE_RATIO_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    if (relevant.length === 0) {
      console.log(`[TOOL] lookup_mct_reference → no results above threshold`);
      return "Релевантных фрагментов справочника не найдено.";
    }
    const titles = relevant.map((r) => r.chunk.title);
    console.log(`[TOOL] lookup_mct_reference → found: ${titles.join(", ")}`);
    return relevant
      .map((r) => `### ${r.chunk.title}\n${r.chunk.content}`)
      .join("\n\n");
  },
  {
    name: "lookup_mct_reference",
    description:
      "Search the educational MCT reference (metacognitive model, ATT, worry/rumination, sleep, boundaries).",
    schema: z.object({
      query: z.string().describe("Search query describing the topic or situation"),
    }),
  }
);

export const searchKnowledgeBase = tool(
  async ({ query, limit = 3 }: { query: string; limit?: number }) => {
    console.log(`[TOOL] search_knowledge_base('${query.slice(0, 80)}')`);
    const results = await semanticSearch(query, { limit, sourceType: "all" });
    if (!results || results.length === 0) {
      return "По запросу в базе знаний ничего не найдено.";
    }
    return results.map((r) => `### Источник\n${r.content}`).join("\n\n---\n\n");
  },
  {
    name: "search_knowledge_base",
    description:
      "Semantic search across all knowledge base materials: books, articles, uploaded documents, MCT/ACT reference. Use for in-depth theoretical questions.",
    schema: z.object({
      query: z.string().describe("Search query in Russian or English"),
      limit: z.number().int().min(1).max(5).optional().default(3),
    }),
  }
);
