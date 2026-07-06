const CONFIDENCE_THRESHOLD = 0.75;
const CATEGORY_KEYWORDS = [
  { category: "Wires & Cables", keywords: ["wire", "cable", "sqmm", "sq mm"] },
  { category: "Switches & Accessories", keywords: ["switch", "socket", "plug", "accessor", "conduit", "pipe", "bend", "junction", "screw", "tape"] },
  { category: "MCBs & Protection", keywords: ["mcb", "breaker", "rccb", "elcb"] },
];
const QTY_REGEX = /(\d+(?:\.\d+)?)\s*(mtr|meter|metre|m|pcs|pc|piece|pieces|box|boxes|nos|no|sqmm|sq\s?mm|units?)\b/gi;
const SIZE_UNIT_REGEX = /^sq\s?mm$/i;
function guessCategory(text) {
  const lower = text.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) if (keywords.some((kw) => lower.includes(kw))) return category;
  return null;
}
function extractQtyUnit(text) {
  // "2.5 sqmm wire 90 mtr": sqmm is usually the conductor size, not the purchase
  // quantity — prefer the last non-size match, falling back to a size-only match.
  const matches = [...text.matchAll(QTY_REGEX)];
  if (matches.length === 0) return { qty: null, unit: null };
  const quantityMatches = matches.filter((m) => !SIZE_UNIT_REGEX.test(m[2]));
  const chosen = (quantityMatches.length > 0 ? quantityMatches : matches).at(-1);
  return { qty: chosen[1], unit: chosen[2] };
}
function parseRequirementLines(lines) {
  return lines.map((line) => {
    const { qty, unit } = extractQtyUnit(line.text);
    return { name: line.text, qty, unit, category: guessCategory(line.text), confidence: line.confidence >= CONFIDENCE_THRESHOLD ? "ok" : "check" };
  });
}
module.exports = { parseRequirementLines, guessCategory, extractQtyUnit, CONFIDENCE_THRESHOLD };
