import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repo root is two levels up from server/src.
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const SPEC_DIR = path.join(DATA_DIR, "spec");
export const ARCHIVE_DIR = path.join(DATA_DIR, "archive");

const envFile = path.join(ROOT_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

export const config = {
  get geminiApiKey() {
    return required("GEMINI_API_KEY");
  },
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  geminiEmbedModel: process.env.GEMINI_EMBED_MODEL || "gemini-embedding-2",
  geminiFallbackModels: (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.5-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  minIntervalMs: Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 1000),
  concurrency: Number(process.env.LLM_CONCURRENCY ?? 4),
};
