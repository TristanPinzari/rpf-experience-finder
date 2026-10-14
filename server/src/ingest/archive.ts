import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ARCHIVE_DIR } from "../config.js";

// Reads the document archive (our stand-in for SharePoint): one folder per project.
// In production this would be the Microsoft Graph API, listing a document library
// with delta queries so only new or changed files come back.

export type ArchiveFile = { filename: string; text: string; sha256: string };
export type ArchiveProject = { id: string; folder: string; files: ArchiveFile[] };

/** Stable URL-friendly id from a messy folder name, e.g. "CHCC + Pool" -> "chcc-pool". */
export function slugify(folder: string): string {
  return folder
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function readArchive(): ArchiveProject[] {
  return readdirSync(ARCHIVE_DIR)
    .filter((folder) => statSync(path.join(ARCHIVE_DIR, folder)).isDirectory())
    .sort()
    .map((folder) => {
      const dir = path.join(ARCHIVE_DIR, folder);
      const files = readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(".txt"))
        .sort()
        .map((filename) => {
          const text = readFileSync(path.join(dir, filename), "utf8").replace(/\r\n/g, "\n");
          return { filename, text, sha256: createHash("sha256").update(text).digest("hex") };
        });
      return { id: slugify(folder), folder, files };
    })
    .filter((p) => p.files.length > 0);
}
