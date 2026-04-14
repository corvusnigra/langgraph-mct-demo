import { VoyageAIClient } from "voyageai";

const MODEL = process.env.VOYAGE_MODEL ?? "voyage-3-lite";
export const DIMS = 1024; // voyage-3-lite dimensions

let _client: VoyageAIClient | null = null;

function getClient(): VoyageAIClient | null {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;
  if (!_client) _client = new VoyageAIClient({ apiKey: key });
  return _client;
}

export async function embedTexts(
  texts: string[],
  inputType: "document" | "query" = "document"
): Promise<number[][] | null> {
  const client = getClient();
  if (!client) return null;
  // Voyage API имеет лимит 128 текстов за раз
  const batches: number[][][] = [];
  for (let i = 0; i < texts.length; i += 128) {
    const batch = texts.slice(i, i + 128);
    const res = await client.embed({ input: batch, model: MODEL, inputType });
    batches.push(res.data!.map((d) => d.embedding!));
  }
  return batches.flat();
}

export function isVoyageAvailable(): boolean {
  return !!process.env.VOYAGE_API_KEY;
}
