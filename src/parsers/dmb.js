// Parse descr_model_battle.txt → Set<modelId>
//
// DMB blocks start with `type <model_id>` at column 0 (or after whitespace).
// Everything else in a block (skeleton, texture, model, animation lines)
// is indented or follows the type line. We only care about the set of
// declared types — that's what EDU's `model id` column is supposed to
// reference.
//
// Parser is tolerant: ignores ;-comments, leading/trailing whitespace,
// and blank lines.
export function parseDMB(text) {
  if (typeof text !== "string" || !text) return new Set();
  const out = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^type\s+(\S+)/i);
    if (m) out.add(m[1]);
  }
  return out;
}
