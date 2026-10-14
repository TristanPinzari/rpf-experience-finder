import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "../config.js";

let client: GoogleGenAI | undefined;
function ai(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Throttling ---------------------------------------------------------------
// Each call starts at least minIntervalMs after the previous one started.
// On the free tier this keeps us under the requests-per-minute cap; on a paid
// key the gap can be small. Started calls can run concurrently.

let nextSlotAt = 0;
async function throttle() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + config.minIntervalMs;
  if (slot > now) await sleep(slot - now);
}

// --- Model fallback -----------------------------------------------------------
// A 503 means Google's servers are overloaded for that model. Rather than wait,
// we mark the model as overloaded for a few minutes and use the next one.

const OVERLOAD_COOLDOWN_MS = 5 * 60_000;
const MAX_WAIT_MS = 60_000; // never sleep longer than this for one retry
const overloadedUntil = new Map<string, number>();

const CHAT_MODELS = () => [config.geminiModel, ...config.geminiFallbackModels];

function currentModel(models: string[]): string {
  const healthy = models.find((m) => (overloadedUntil.get(m) ?? 0) <= Date.now());
  return healthy ?? models[models.length - 1];
}

// --- Retries --------------------------------------------------------------------

function hintedDelayMs(err: ApiError): number | undefined {
  // 429 errors usually say how long to wait, e.g. "retryDelay":"23s".
  const match = /retryDelay"?:\s*"?(\d+(?:\.\d+)?)s/.exec(err.message);
  return match ? Math.ceil(Number(match[1]) * 1000) + 500 : undefined;
}

async function withRetry<T>(
  label: string,
  models: string[],
  fn: (model: string) => Promise<T>,
  maxAttempts = 6,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const model = currentModel(models);
    await throttle();
    try {
      return await fn(model);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const retryable = err.status === 429 || err.status >= 500;
      if (!retryable || attempt >= maxAttempts) throw err;

      const hinted = hintedDelayMs(err);
      const quota = /"quotaId":\s*"([^"]+)"/.exec(err.message)?.[1];
      if (err.status === 503) {
        overloadedUntil.set(model, Date.now() + OVERLOAD_COOLDOWN_MS);
      } else if (hinted !== undefined && hinted > MAX_WAIT_MS) {
        // A long wait means a daily quota is used up: treat the model as unavailable.
        overloadedUntil.set(model, Date.now() + hinted);
      }

      const next = currentModel(models);
      if (next === model && hinted !== undefined && hinted > MAX_WAIT_MS) {
        throw new Error(
          `${model} quota exhausted (${quota ?? "unknown quota"}), resets in ~${Math.round(hinted / 3_600_000)}h, and no fallback model is available.`,
        );
      }
      const delay =
        next !== model
          ? 1000 // a different model is available: switch almost immediately
          : (hinted ?? Math.min(2 ** attempt * 2000, MAX_WAIT_MS));

      console.warn(
        `  [${label}] ${err.status} from ${model}${quota ? ` (${quota})` : ""}, attempt ${attempt}/${maxAttempts}, retrying on ${next} in ${Math.round(delay / 1000)}s`,
      );
      if (!quota) console.warn(`    ${err.message.slice(0, 300)}`);
      await sleep(delay);
    }
  }
}

// --- Structured generation --------------------------------------------------
// The Zod schema does double duty: it becomes the JSON schema Gemini must
// follow, and it validates whatever comes back.

function toGeminiSchema(schema: z.ZodType): unknown {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export async function generateJson<S extends z.ZodType>(opts: {
  schema: S;
  prompt: string;
  system?: string;
  temperature?: number;
  label?: string;
}): Promise<z.infer<S>> {
  return withRetry(opts.label ?? "generate", CHAT_MODELS(), async (model) => {
    const res = await ai().models.generateContent({
      model,
      contents: opts.prompt,
      config: {
        systemInstruction: opts.system,
        temperature: opts.temperature,
        responseMimeType: "application/json",
        responseJsonSchema: toGeminiSchema(opts.schema),
      },
    });
    const text = res.text;
    if (!text) throw new Error(`Empty response from ${model}`);
    return opts.schema.parse(JSON.parse(text));
  });
}

// --- Embeddings -----------------------------------------------------------------
// Gemini Embedding 2 takes the retrieval task as a text prefix, not a parameter.
// Documents and queries use different prefixes so they land in the same space
// but are embedded "for" their role. There is deliberately no fallback model:
// vectors from different models are not comparable.

export const EMBED_DIMENSIONS = 768;
const EMBED_BATCH = 50;

export type EmbedInput = { kind: "document"; title: string; text: string } | { kind: "query"; text: string };

function embedPrompt(input: EmbedInput): string {
  return input.kind === "query"
    ? `task: search result | query: ${input.text}`
    : `title: ${input.title || "none"} | text: ${input.text}`;
}

export async function embed(inputs: EmbedInput[], label = "embed"): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
    const batch = inputs.slice(i, i + EMBED_BATCH).map(embedPrompt);
    const res = await withRetry(label, [config.geminiEmbedModel], (model) =>
      ai().models.embedContent({
        model,
        // One Content object per text. A plain string array is treated as one
        // multi-part input and returns a single combined embedding.
        contents: batch.map((text) => ({ parts: [{ text }] })),
        config: { outputDimensionality: EMBED_DIMENSIONS },
      }),
    );
    const vectors = res.embeddings ?? [];
    if (vectors.length !== batch.length) {
      throw new Error(`Expected ${batch.length} embeddings, got ${vectors.length}`);
    }
    for (const v of vectors) out.push(normalize(Float32Array.from(v.values ?? [])));
  }
  return out;
}

/** Scale to unit length, so cosine similarity becomes a plain dot product. */
function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

export function chatModelName(): string {
  return currentModel(CHAT_MODELS());
}
