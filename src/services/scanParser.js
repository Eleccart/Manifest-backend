const CONFIDENCE_THRESHOLD = 0.75;
const CATEGORY_KEYWORDS = [
  { category: "Wires & Cables", keywords: ["wire", "cable", "sqmm", "sq mm"] },
  { category: "Switches & Accessories", keywords: ["switch", "socket", "plug", "accessor"] },
  { category: "MCBs & Protection", keywords: ["mcb", "breaker", "rccb", "elcb"] },
];
const QTY_REGEX = /(\d+(?:\.\d+)?)\s*(mtr|meter|metre|m|pcs|pc|piece|pieces|box|boxes|nos|no|sqmm|sq\s?mm|units?)\b/i;
function guessCategory(text) {
  const lower = text.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) if (keywords.some((kw) => lower.includes(kw))) return category;
  return null;
}
function extractQtyUnit(text) {
  const match = text.match(QTY_REGEX);
  if (!match) return { qty: null, unit: null };
  return { qty: match[1], unit: match[2] };
}
function parseRequirementLines(lines) {
  return lines.map((line) => {
    const { qty, unit } = extractQtyUnit(line.text);
    return { name: line.text, qty, unit, category: guessCategory(line.text), confidence: line.confidence >= CONFIDENCE_THRESHOLD ? "ok" : "check" };
  });
}
module.exports = { parseRequirementLines, guessCategory, extractQtyUnit, CONFIDENCE_THRESHOLD };
