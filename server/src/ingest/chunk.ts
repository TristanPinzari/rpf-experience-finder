// Splits a document into chunks for search.
//
// Chunks follow paragraph boundaries so a sentence is never cut in half, and
// each chunk repeats the previous paragraph (overlap) so context that spans a
// boundary isn't lost. Our documents are short, so most produce 1 to 3 chunks.

const TARGET_CHARS = 900;
const MAX_CHARS = 1500;

export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph);

  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;

  for (const para of paragraphs) {
    if (size > 0 && size + para.length > TARGET_CHARS) {
      chunks.push(current.join("\n\n"));
      const overlap = current[current.length - 1];
      current = overlap.length < TARGET_CHARS / 2 ? [overlap] : [];
      size = current.reduce((n, p) => n + p.length, 0);
    }
    current.push(para);
    size += para.length;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

/** Very long paragraphs (e.g. a table with no blank lines) are split by line. */
function splitLongParagraph(para: string): string[] {
  if (para.length <= MAX_CHARS) return [para];
  const out: string[] = [];
  let buf = "";
  for (const line of para.split("\n")) {
    if (buf && buf.length + line.length > TARGET_CHARS) {
      out.push(buf);
      buf = "";
    }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf) out.push(buf);
  return out;
}
