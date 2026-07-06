const pool = require("../db/pool");
const MATCH_THRESHOLD = 0.35;
function tokenize(text) {
  return new Set(String(text).toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length > 1));
}
function matchScore(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}
async function buildQuoteLines(scanId) {
  const { rows: items } = await pool.query(`SELECT id, category_id, name, qty, unit FROM scan_items WHERE scan_id = $1 ORDER BY id`, [scanId]);
  const { rows: assignments } = await pool.query(`SELECT category_id, brand_id, family_id FROM category_brand_assignments WHERE scan_id = $1`, [scanId]);
  const { rows: overrides } = await pool.query(`SELECT o.scan_item_id, o.brand_id, o.family_id FROM item_brand_overrides o JOIN scan_items si ON si.id = o.scan_item_id WHERE si.scan_id = $1`, [scanId]);
  const assignmentByCategory = new Map(assignments.map((a) => [String(a.category_id), a]));
  const overrideByItem = new Map(overrides.map((o) => [String(o.scan_item_id), o]));
  const lines = [];
  for (const item of items) {
    const resolved = overrideByItem.get(String(item.id)) || (item.category_id && assignmentByCategory.get(String(item.category_id))) || null;
    let priceItem = null;
    if (resolved && item.category_id) {
      const { rows: candidates } = await pool.query(`SELECT id, description, unit, unit_price, family_id FROM price_list_items WHERE category_id = $1 AND brand_id = $2`, [item.category_id, resolved.brand_id]);
      let best = null;
      let bestScore = 0;
      for (const candidate of candidates) {
        // Slight boost when the candidate belongs to the assigned product family.
        let score = matchScore(item.name, candidate.description);
        if (resolved.family_id && String(candidate.family_id) === String(resolved.family_id)) score += 0.1;
        if (score > bestScore) { best = candidate; bestScore = score; }
      }
      if (best && bestScore >= MATCH_THRESHOLD) priceItem = best;
    }
    const parsedQty = parseFloat(item.qty);
    const qty = parsedQty > 0 ? parsedQty : 1;
    const unitPrice = priceItem ? parseFloat(priceItem.unit_price) : 0;
    lines.push({
      scan_item_id: item.id,
      description: item.name,
      price_list_item_id: priceItem ? priceItem.id : null,
      matched_description: priceItem ? priceItem.description : null,
      qty,
      unit: item.unit || (priceItem ? priceItem.unit : null),
      unit_price: unitPrice,
      line_total: Math.round(qty * unitPrice * 100) / 100,
      needs_price: !priceItem,
    });
  }
  return lines;
}
module.exports = { buildQuoteLines, matchScore, MATCH_THRESHOLD };
