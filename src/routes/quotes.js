const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const { suggestCategoryDiscount } = require("../services/discountHistory");
const router = express.Router();
router.use(requireAuth);
async function recomputeLineItem(lineItemId) {
  const { rows } = await pool.query(
    `SELECT qli.id, qli.quote_id, qli.qty, qli.unit_price, qli.gst_rate, qli.price_list_item_id, pli.category_id,
            q.apply_gst,
            ido.discount_percent AS override_discount, cd.discount_percent AS category_discount
     FROM quote_line_items qli
     JOIN quotes q ON q.id = qli.quote_id
     LEFT JOIN price_list_items pli ON pli.id = qli.price_list_item_id
     LEFT JOIN item_discount_overrides ido ON ido.quote_line_item_id = qli.id
     LEFT JOIN category_discounts cd ON cd.quote_id = qli.quote_id AND cd.category_id = pli.category_id
     WHERE qli.id = $1`,
    [lineItemId]
  );
  const row = rows[0];
  if (!row) return null;
  const effectiveDiscount = row.override_discount ?? row.category_discount ?? 0;
  const discountedUnitPrice = Number(row.unit_price) * (1 - Number(effectiveDiscount) / 100);
  const lineTotal = discountedUnitPrice * Number(row.qty);
  // gst_rate stays snapshotted on the line; apply_gst=false zeroes the amounts
  // so tax can be toggled back on later.
  const gstRate = row.apply_gst ? Number(row.gst_rate) : 0;
  const gstAmount = lineTotal * (gstRate / 100);
  const cgstAmount = gstAmount / 2;
  const sgstAmount = gstAmount / 2;
  const totalWithGst = lineTotal + gstAmount;
  const { rows: updated } = await pool.query(
    `UPDATE quote_line_items SET discount_percent = $1, discounted_unit_price = $2, line_total = $3,
     cgst_amount = $4, sgst_amount = $5, total_with_gst = $6 WHERE id = $7
     RETURNING id, qty, unit_price, discount_percent, discounted_unit_price, line_total, gst_rate, cgst_amount, sgst_amount, total_with_gst`,
    [effectiveDiscount, discountedUnitPrice.toFixed(2), lineTotal.toFixed(2), cgstAmount.toFixed(2), sgstAmount.toFixed(2), totalWithGst.toFixed(2), lineItemId]
  );
  return updated[0];
}
async function recomputeQuoteTotals(quoteId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(line_total), 0) AS subtotal, COALESCE(SUM(cgst_amount), 0) AS total_cgst,
            COALESCE(SUM(sgst_amount), 0) AS total_sgst, COALESCE(SUM(total_with_gst), 0) AS grand_total
     FROM quote_line_items WHERE quote_id = $1`,
    [quoteId]
  );
  const { subtotal, total_cgst, total_sgst, grand_total } = rows[0];
  const { rows: updated } = await pool.query(
    `UPDATE quotes SET subtotal = $1, total_cgst = $2, total_sgst = $3, grand_total = $4, total_amount = $4 WHERE id = $5
     RETURNING id, subtotal, total_cgst, total_sgst, grand_total, total_amount`,
    [subtotal, total_cgst, total_sgst, grand_total, quoteId]
  );
  return updated[0];
}
async function recomputeAllLineItemsForCategory(quoteId, categoryId) {
  const { rows } = await pool.query(
    `SELECT qli.id FROM quote_line_items qli JOIN price_list_items pli ON pli.id = qli.price_list_item_id
     WHERE qli.quote_id = $1 AND pli.category_id = $2
       AND NOT EXISTS (SELECT 1 FROM item_discount_overrides ido WHERE ido.quote_line_item_id = qli.id)`,
    [quoteId, categoryId]
  );
  for (const row of rows) await recomputeLineItem(row.id);
}
// Coil length convention: default 90m unless the line specifies 180.
function coilPreference(name) {
  return /\b180\s*(m|mtr|meter|metre)?\b/i.test(String(name)) ? 180 : 90;
}
const LENGTH_UNITS = new Set(["mtr", "meter", "metre", "m"]);
function sizePreference(name) {
  // Accept the OCR-mangled sqmm spellings the scan parser recognizes.
  const match = String(name).match(/([0-9]+(?:\.[0-9]+)?)\s*(?:sq\.?\s?mm|sqmm|squm|squam|sqm|soma|mm)\b/i);
  return match ? match[1] : null;
}
router.post("/scans/:scanId/quote", async (req, res, next) => {
  try {
    const { quote_type, customer_id, apply_gst = true, show_discount = true } = req.body;
    if (!["default", "customer"].includes(quote_type)) return res.status(400).json({ error: "quote_type must be 'default' or 'customer'." });
    const quoteResult = await pool.query(
      `INSERT INTO quotes (scan_id, customer_id, quote_type, status, apply_gst, show_discount) VALUES ($1, $2, $3, 'draft', $4, $5) RETURNING id, scan_id, customer_id, quote_type, status, apply_gst, show_discount`,
      [req.params.scanId, customer_id || null, quote_type, Boolean(apply_gst), Boolean(show_discount)]
    );
    const quote = quoteResult.rows[0];
    const { rows: items } = await pool.query(
      `SELECT si.id AS scan_item_id, si.category_id, si.name, si.qty, si.unit,
              COALESCE(ibo.brand_id, cba.brand_id) AS brand_id, COALESCE(ibo.family_id, cba.family_id) AS family_id
       FROM scan_items si
       LEFT JOIN item_brand_overrides ibo ON ibo.scan_item_id = si.id
       LEFT JOIN category_brand_assignments cba ON cba.scan_id = si.scan_id AND cba.category_id = si.category_id
       WHERE si.scan_id = $1`,
      [req.params.scanId]
    );
    const lineItems = [];
    const unmatched = [];
    const categoriesSeen = new Map();
    for (const item of items) {
      if (!item.brand_id) { unmatched.push({ scan_item_id: item.scan_item_id, name: item.name, reason: "No brand assigned." }); continue; }
      categoriesSeen.set(item.category_id, { brand_id: item.brand_id, family_id: item.family_id });
      // Nomenclature carries brand + family + size + pack ("Apar Anushakti 1.5
      // sqmm 180mtr"): with no explicit family assignment, match any family and
      // prefer the one whose line name (first word, e.g. Anushakti) appears in
      // the scanned item text. Size/pack matching uses the structured columns
      // (backfilled from descriptions) instead of parsing description text.
      const priceMatch = await pool.query(
        `SELECT pli.id, pli.unit_price, pli.hsn_code, pli.gst_rate, pli.unit, pli.pack_qty, pli.pack_unit
         FROM price_list_items pli
         LEFT JOIN product_families pf ON pf.id = pli.family_id
         WHERE pli.category_id = $1 AND pli.brand_id = $2 AND ($3::bigint IS NULL OR pli.family_id = $3)
         ORDER BY pli.is_regular DESC,
           CASE WHEN $4::numeric IS NOT NULL AND pli.size_value = $4::numeric THEN 0 ELSE 1 END,
           CASE WHEN pf.name IS NOT NULL AND lower($6) ~ ('\\m' || lower(split_part(pf.name, ' ', 1)) || '\\M') THEN 0 ELSE 1 END,
           CASE WHEN pli.pack_qty = $5::numeric THEN 0 ELSE 1 END,
           pli.id
         LIMIT 1`,
        [item.category_id, item.brand_id, item.family_id, sizePreference(item.name), coilPreference(item.name), String(item.name || "")]
      );
      if (!priceMatch.rows[0]) { unmatched.push({ scan_item_id: item.scan_item_id, name: item.name, reason: "No matching price list entry for this brand/family." }); continue; }
      const matched = priceMatch.rows[0];
      const scannedQty = parseFloat(item.qty) || 0;
      const unitPrice = Number(matched.unit_price);
      // If the price is per-pack (e.g. a 90m coil) and the scan quantity is in
      // the pack's base unit (e.g. metres of wire), convert to packs needed
      // instead of pricing the raw scanned number as if it were pack count.
      const scannedUnit = String(item.unit || "").toLowerCase();
      const packAware = matched.pack_qty && Number(matched.pack_qty) > 0 && LENGTH_UNITS.has(scannedUnit);
      const qtyNum = packAware ? Math.max(1, Math.ceil(scannedQty / Number(matched.pack_qty))) : (scannedQty || 1);
      const lineUnit = packAware ? matched.unit : (item.unit || matched.unit);
      const gstRate = Number(matched.gst_rate);
      const effectiveGstRate = quote.apply_gst ? gstRate : 0;
      const lineTotal = unitPrice * qtyNum;
      const gstAmount = lineTotal * (effectiveGstRate / 100);
      const { rows: inserted } = await pool.query(
        `INSERT INTO quote_line_items (quote_id, price_list_item_id, qty, unit, unit_price, discounted_unit_price, line_total, hsn_code, gst_rate, cgst_amount, sgst_amount, total_with_gst)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $9, $10)
         RETURNING id, price_list_item_id, qty, unit, unit_price, discount_percent, discounted_unit_price, line_total, hsn_code, gst_rate, cgst_amount, sgst_amount, total_with_gst`,
        [quote.id, matched.id, qtyNum, lineUnit, unitPrice, lineTotal.toFixed(2), matched.hsn_code, gstRate, (gstAmount / 2).toFixed(2), (lineTotal + gstAmount).toFixed(2)]
      );
      lineItems.push(inserted[0]);
    }
    await recomputeQuoteTotals(quote.id);
    const suggestedDiscounts = [];
    for (const [categoryId, { brand_id, family_id }] of categoriesSeen) {
      const suggestion = await suggestCategoryDiscount({ categoryId, brandId: brand_id, familyId: family_id, customerId: customer_id });
      suggestedDiscounts.push({ category_id: categoryId, ...suggestion });
    }
    res.status(201).json({ quote, line_items: lineItems, unmatched, suggested_discounts: suggestedDiscounts });
  } catch (err) { next(err); }
});
router.put("/quotes/:quoteId/categories/:categoryId/discount", async (req, res, next) => {
  try {
    const { discount_percent } = req.body;
    if (discount_percent === undefined || discount_percent < 0 || discount_percent > 100) return res.status(400).json({ error: "discount_percent must be between 0 and 100." });
    await pool.query(
      `INSERT INTO category_discounts (quote_id, category_id, discount_percent) VALUES ($1, $2, $3)
       ON CONFLICT (quote_id, category_id) DO UPDATE SET discount_percent = EXCLUDED.discount_percent`,
      [req.params.quoteId, req.params.categoryId, discount_percent]
    );
    await recomputeAllLineItemsForCategory(req.params.quoteId, req.params.categoryId);
    const quoteTotals = await recomputeQuoteTotals(req.params.quoteId);
    const { rows } = await pool.query(
      `SELECT qli.id, qli.qty, qli.unit_price, qli.discount_percent, qli.discounted_unit_price, qli.line_total, qli.gst_rate, qli.cgst_amount, qli.sgst_amount, qli.total_with_gst
       FROM quote_line_items qli JOIN price_list_items pli ON pli.id = qli.price_list_item_id
       WHERE qli.quote_id = $1 AND pli.category_id = $2`,
      [req.params.quoteId, req.params.categoryId]
    );
    res.json({ discount_percent, line_items: rows, quote_totals: quoteTotals });
  } catch (err) { next(err); }
});
router.put("/quotes/:quoteId/line-items/:lineItemId/discount-override", async (req, res, next) => {
  try {
    const { discount_percent } = req.body;
    if (discount_percent === undefined || discount_percent < 0 || discount_percent > 100) return res.status(400).json({ error: "discount_percent must be between 0 and 100." });
    await pool.query(
      `INSERT INTO item_discount_overrides (quote_line_item_id, discount_percent) VALUES ($1, $2)
       ON CONFLICT (quote_line_item_id) DO UPDATE SET discount_percent = EXCLUDED.discount_percent`,
      [req.params.lineItemId, discount_percent]
    );
    const lineItem = await recomputeLineItem(req.params.lineItemId);
    const quoteTotals = await recomputeQuoteTotals(req.params.quoteId);
    res.json({ line_item: lineItem, quote_totals: quoteTotals });
  } catch (err) { next(err); }
});
router.delete("/quotes/:quoteId/line-items/:lineItemId/discount-override", async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM item_discount_overrides WHERE quote_line_item_id = $1`, [req.params.lineItemId]);
    const lineItem = await recomputeLineItem(req.params.lineItemId);
    const quoteTotals = await recomputeQuoteTotals(req.params.quoteId);
    res.json({ line_item: lineItem, quote_totals: quoteTotals });
  } catch (err) { next(err); }
});
router.put("/quotes/:quoteId/settings", async (req, res, next) => {
  try {
    const { apply_gst, show_discount } = req.body || {};
    if (apply_gst === undefined && show_discount === undefined) return res.status(400).json({ error: "Provide apply_gst and/or show_discount." });
    const { rows } = await pool.query(
      `UPDATE quotes SET apply_gst = COALESCE($1::boolean, apply_gst), show_discount = COALESCE($2::boolean, show_discount) WHERE id = $3 RETURNING id`,
      [apply_gst, show_discount, req.params.quoteId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Quote not found." });
    const { rows: lineRows } = await pool.query(`SELECT id FROM quote_line_items WHERE quote_id = $1`, [req.params.quoteId]);
    for (const line of lineRows) await recomputeLineItem(line.id);
    await recomputeQuoteTotals(req.params.quoteId);
    const { rows: refreshed } = await pool.query(
      `SELECT id, scan_id, customer_id, quote_type, status, apply_gst, show_discount, subtotal, total_cgst, total_sgst, grand_total FROM quotes WHERE id = $1`,
      [req.params.quoteId]
    );
    res.json({ quote: refreshed[0] });
  } catch (err) { next(err); }
});
router.post("/quotes/:quoteId/finalize", async (req, res, next) => {
  try {
    const quoteTotals = await recomputeQuoteTotals(req.params.quoteId);
    const { rows } = await pool.query(
      `UPDATE quotes SET status = 'final' WHERE id = $1 RETURNING id, scan_id, customer_id, quote_type, status, subtotal, total_cgst, total_sgst, grand_total`,
      [req.params.quoteId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Quote not found." });
    res.json({ quote: rows[0] });
  } catch (err) { next(err); }
});
router.get("/quotes/:quoteId", async (req, res, next) => {
  try {
    const { rows: quoteRows } = await pool.query(
      `SELECT id, scan_id, customer_id, quote_type, status, apply_gst, show_discount, subtotal, total_cgst, total_sgst, grand_total, created_at FROM quotes WHERE id = $1`,
      [req.params.quoteId]
    );
    if (!quoteRows[0]) return res.status(404).json({ error: "Quote not found." });
    const { rows: lineItems } = await pool.query(
      `SELECT qli.id, qli.qty, qli.unit_price, qli.discount_percent, qli.discounted_unit_price, qli.line_total,
              qli.hsn_code, qli.gst_rate, qli.cgst_amount, qli.sgst_amount, qli.total_with_gst,
              pli.description, pli.sku, c.name AS category_name, b.name AS brand_name, pf.name AS family_name
       FROM quote_line_items qli
       JOIN price_list_items pli ON pli.id = qli.price_list_item_id
       JOIN categories c ON c.id = pli.category_id
       JOIN brands b ON b.id = pli.brand_id
       LEFT JOIN product_families pf ON pf.id = pli.family_id
       WHERE qli.quote_id = $1 ORDER BY qli.id`,
      [req.params.quoteId]
    );
    res.json({ quote: quoteRows[0], line_items: lineItems });
  } catch (err) { next(err); }
});
module.exports = router;
