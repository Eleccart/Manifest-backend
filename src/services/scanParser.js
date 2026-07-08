const CONFIDENCE_THRESHOLD = 0.75;

// Template vocabulary printed on estimate slips — not product words.
const TEMPLATE_WORDS = new Set([
  "no", "sno", "sr", "srno", "particulars", "particular", "item", "items", "description",
  "qty", "quantity", "rate", "amount", "amt", "total", "subtotal", "grand",
  "cgst", "sgst", "igst", "gst", "tax", "est", "estimate", "quotation", "invoice", "bill",
  "name", "date", "page", "sign", "signature", "customer", "mob", "mobile", "ph", "phone",
  "address", "add", "st", "mrp", "hsn", "code", "led", "light", "lights"
]);

const SQMM_VARIANTS = /(sq\.?\s?mm|sqmm|squm|squam|sqm|soma\b)/i;

const CATEGORY_RULES = [
  { category: "Wires and Cables", test: (t) => SQMM_VARIANTS.test(t) || /(wire|cable|anushakti|anuskabi|anushakli|apar|polycab|finolex)/i.test(t) },
  { category: "Switch Socket", test: (t) => /(switch|socket|plug|accessor|legrand|arteor|mylinc|myrius|roma|ziva|crabtree)/i.test(t) },
  { category: "MCB DB", test: (t) => /(mcb|breaker|rccb|elcb|distribution board)/i.test(t) },
  { category: "Electrical Accessories", test: (t) => /(conduit|pipe|bend|junction|screw|tape)/i.test(t) },
  { category: "Fans", test: (t) => /(fan|exhaust|atomberg)/i.test(t) },
  { category: "Pumps", test: (t) => /(pump|motor)/i.test(t) },
  { category: "Stabilizers", test: (t) => /(stabilizer|stabiliser)/i.test(t) },
  { category: "Home Appliances", test: (t) => /(geyser|heater|iron|kettle|mixer|grinder|appliance)/i.test(t) },
  { category: "Lighting", test: (t) => /(light|led|bulb|lamp|batten|tube|luker)/i.test(t) },
];

const QTY_WITH_UNIT = /(\d+(?:\.\d+)?)\s*(mtr|meter|metre|pcs|pc|piece|pieces|box|boxes|nos|no|units?|doz|bndl)\b/i;
const TRAILING_QTY = /\s(\d{1,4})\s*$/;
const LEADING_LENGTH = /^\s*\d+\s*(mtr|meter|metre|m)\b/i;
const DATE_LIKE = /^\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\s*$/;
// Written serial like "1." or "2)" — only with a separator symbol, so bare
// leading numbers ("180mtr...", "2 way switch") are never stripped.
const LEADING_SERIAL = /^\s*\d{1,2}\s*[).\-:]\s*/;

// A line is noise unless it has at least one substantive token:
// an alphabetic word, 3+ chars, that is NOT template vocabulary.
function isNoise(text) {
  if (DATE_LIKE.test(text)) return true;
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const substantive = tokens.filter((t) => t.length >= 3 && !TEMPLATE_WORDS.has(t));
  return substantive.length === 0;
}

function guessCategory(text) {
  for (const rule of CATEGORY_RULES) if (rule.test(text)) return rule.category;
  return null;
}

function extractQty(text) {
  text = text.replace(LEADING_SERIAL, "");
  const withoutLeading = text.replace(LEADING_LENGTH, "");
  const unitMatch = withoutLeading.match(QTY_WITH_UNIT);
  if (unitMatch) return { qty: unitMatch[1], unit: unitMatch[2], name: text.trim() };
  const trailing = text.match(TRAILING_QTY);
  if (trailing) return { qty: String(parseInt(trailing[1], 10)), unit: null, name: text.replace(TRAILING_QTY, "").trim() };
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
