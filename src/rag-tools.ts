import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { MCT_REFERENCE, type MctReferenceChunk } from "./mct-reference";

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

const SCORE_THRESHOLD = 4;

function keywordScore(query: string, chunk: MctReferenceChunk): number {
  const words = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w && !STOP_WORDS.has(w))
  );
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
    const scored = MCT_REFERENCE.map((chunk) => ({
      chunk,
      score: keywordScore(query, chunk),
    }));
    const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    for (const { chunk, score } of hits) {
      const ok = score >= SCORE_THRESHOLD ? "✅" : "❌";
      console.log(`  ${ok} [${score}] ${chunk.title}`);
    }
    const relevant = scored
      .filter((x) => x.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    if (relevant.length === 0) {
      console.log(`[TOOL] lookup_mct_reference → no results above threshold (${SCORE_THRESHOLD})`);
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
