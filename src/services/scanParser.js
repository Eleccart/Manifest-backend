const CONFIDENCE_THRESHOLD = 0.75;

// Printed template words that appear on estimate slips — lines that are
// only these (or fragments under 3 chars) are noise, not items.
const NOISE_WORDS = new Set(["no", "particulars", "qty", "rate", "amount", "total", "cgst", "sgst", "igst", "est", "estimate", "name", "date", "st"]);

// sqmm arrives mangled from handwriting OCR: squm, squm, squam, soma, sq mm, sqm
const SQMM_VARIANTS = /(sq\.?\s?mm|sqmm|squm|squm|squam|sqm|soma\b)/i;

const CATEGORY_RULES = [
  { category: "Wires and Cables", test: (t) => SQMM_VARIANTS.test(t) || /(wire|cable|anushakti|anuskabi|anushakli|apar|polycab|finolex|havells\s*wire)/i.test(t) },
  { category: "Switch Socket", test: (t) => /(switch|socket|plug|legrand|arteor|mylinc|myrius|roma|ziva|crabtree)/i.test(t) },
  { category: "MCB DB", test: (t) => /(mcb|breaker|rccb|elcb|distribution board)/i.test(t) },
  { category: "Electrical Accessories", test: (t) => /(conduit|pipe|bend|junction|screw|tape|accessor)/i.test(t) },
  { category: "Fans", test: (t) => /(fan|exhaust|atomberg)/i.test(t) },
  { category: "Pumps", test: (t) => /(pump|motor)/i.test(t) },
  { category: "Stabilizers", test: (t) => /(stabilizer|stabiliser)/i.test(t) },
  { category: "Home Appliances", test: (t) => /(geyser|heater|iron|kettle|mixer|grinder|appliance)/i.test(t) },
  { category: "Lighting", test: (t) => /(light|led|bulb|lamp|batten|tube|luker)/i.test(t) },
];

// Explicit qty with unit, e.g. "12 pcs", "90 mtr"
const QTY_WITH_UNIT = /(\d+(?:\.\d+)?)\s*(mtr|meter|metre|pcs|pc|piece|pieces|box|boxes|nos|no|units?|doz|bndl)\b/i;
// Bare trailing number = qty column bleeding into the line, e.g. "... 1 Sqmm 03"
const TRAILING_QTY = /\s(\d{1,4})\s*$/;
// Leading coil-length like "180mtr" — part of the item name, NOT the qty
const LEADING_LENGTH = /^\s*\d+\s*(mtr|meter|metre|m)\b/i;

function isNoise(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length < 3) return true;
  return NOISE_WORDS.has(cleaned);
}

function guessCategory(text) {
  for (const rule of CATEGORY_RULES) if (rule.test(text)) return rule.category;
  return null;
}

function extractQty(text) {
  // Prefer an explicit "N unit" that is NOT the leading coil length
  const withoutLeading = text.replace(LEADING_LENGTH, "");
  const unitMatch = withoutLeading.match(QTY_WITH_UNIT);
  if (unitMatch) return { qty: unitMatch[1], unit: unitMatch[2], name: text.trim() };
  // Otherwise a bare trailing number is the qty column
  const trailing = text.match(TRAILING_QTY);
  if (trailing) {
    return { qty: String(parseInt(trailing[1], 10)), unit: null, name: text.replace(TRAILING_QTY, "").trim() };
  }
  return { qty: null, unit: null, name: text.trim() };
}

function parseRequirementLines(lines) {
  return lines
    .filter((line) => !isNoise(line.text))
    .map((line) => {
      const { qty, unit, name } = extractQty(line.text);
      return {
        name,
        qty,
        unit,
        category: guessCategory(line.text),
        confidence: line.confidence >= CONFIDENCE_THRESHOLD ? "ok" : "check",
      };
    });
}

module.exports = { parseRequirementLines, guessCategory, extractQty, CONFIDENCE_THRESHOLD };
