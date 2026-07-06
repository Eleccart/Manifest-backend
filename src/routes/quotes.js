const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const { suggestCategoryDiscount } = require("../services/discountHistory");
const router = express.Router();
router.use(requireAuth);
async function recomputeLineItem(lineItemId) {
  const { rows } = await pool.query(
    `SELECT qli.id, qli.quote_id, qli.qty, qli.unit_price, qli.price_list_item_id, pli.category_id,
            ido.discount_percent AS override_discount, cd.discount_percent AS category_discount
     FROM quote_line_items qli
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
  const { rows: updated } = await pool.query(
    `UPDATE quote_line_items SET discount_percent = $1, discounted_unit_price = $2, line_total = $3 WHERE id = $4
     RETURNING id, qty, unit_price, discount_percent, discounted_unit_price, line_total`,
    [effectiveDiscount, discountedUnitPrice.toFixed(2), lineTotal.toFixed(2), lineItemId]
  );
  return updated[0];
}
async function recomputeAllLineItemsForCategory(quoteId, categoryId) {
  const { rows } = await pool.query(
    `SELECT qli.id FROM quote_line_items qli
     JOIN price_list_items pli ON pli.id = qli.price_list_item_id
     WHERE qli.quote_id = $1 AND pli.category_id = $2
       AND NOT EXISTS (SELECT 1 FROM item_discount_overrides ido WHERE ido.quote_line_item_id = qli.id)`,
    [quoteId, categoryId]
  );
  for (const row of rows) await recomputeLineItem(row.id);
}
router.post("/scans/:scanId/quote", async (req, res, next) => {
  try {
    const { quote_type, customer_id } = req.body;
    if (!["default", "customer"].includes(quote_type)) return res.status(400).json({ error: "quote_type must be 'default' or 'customer'." });
    const quoteResult = await pool.query(
      `INSERT INTO quotes (scan_id, customer_id, quote_type, status) VALUES ($1, $2, $3, 'draft') RETURNING id, scan_id, customer_id, quote_type, status`,
      [req.params.scanId, customer_id || null, quote_type]
    );
    const quote = quoteResult.rows[0];
    const { rows: items } = await pool.query(
      `SELECT si.id AS scan_item_id, si.category_id, si.name, si.qty,
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
      const priceMatch = await pool.query(
        `SELECT id, unit_price FROM price_list_items WHERE category_id = $1 AND brand_id = $2 AND (family_id = $3 OR ($3 IS NULL AND family_id IS NULL)) LIMIT 1`,
        [item.category_id, item.brand_id, item.family_id]
      );
      if (!priceMatch.rows[0]) { unmatched.push({ scan_item_id: item.scan_item_id, name: item.name, reason: "No matching price list entry for this brand/family." }); continue; }
      const qtyNum = parseFloat(item.qty) || 0;
      const unitPrice = Number(priceMatch.rows[0].unit_price);
      const { rows: inserted } = await pool.query(
        `INSERT INTO quote_line_items (quote_id, price_list_item_id, qty, unit_price, discounted_unit_price, line_total) VALUES ($1, $2, $3, $4, $4, $5)
         RETURNING id, price_list_item_id, qty, unit_price, discount_percent, discounted_unit_price, line_total`,
        [quote.id, priceMatch.rows[0].id, qtyNum, unitPrice, (unitPrice * qtyNum).toFixed(2)]
      );
      lineItems.push(inserted[0]);
    }
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
    const { rows } = await pool.query(
      `SELECT qli.id, qli.qty, qli.unit_price, qli.discount_percent, qli.discounted_unit_price, qli.line_total
       FROM quote_line_items qli JOIN price_list_items pli ON pli.id = qli.price_list_item_id
       WHERE qli.quote_id = $1 AND pli.category_id = $2`,
      [req.params.quoteId, req.params.categoryId]
    );
    res.json({ discount_percent, line_items: rows });
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
    res.json({ line_item: lineItem });
  } catch (err) { next(err); }
});
router.delete("/quotes/:quoteId/line-items/:lineItemId/discount-override", async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM item_discount_overrides WHERE quote_line_item_id = $1`, [req.params.lineItemId]);
    const lineItem = await recomputeLineItem(req.params.lineItemId);
    res.json({ line_item: lineItem });
  } catch (err) { next(err); }
});
router.post("/quotes/:quoteId/finalize", async (req, res, next) => {
  try {
    const { rows: totalRows } = await pool.query(`SELECT COALESCE(SUM(line_total), 0) AS total FROM quote_line_items WHERE quote_id = $1`, [req.params.quoteId]);
    const { rows } = await pool.query(
      `UPDATE quotes SET status = 'final', total_amount = $1 WHERE id = $2 RETURNING id, scan_id, customer_id, quote_type, status, total_amount`,
      [totalRows[0].total, req.params.quoteId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Quote not found." });
    res.json({ quote: rows[0] });
  } catch (err) { next(err); }
});
router.get("/quotes/:quoteId", async (req, res, next) => {
  try {
    const { rows: quoteRows } = await pool.query(`SELECT id, scan_id, customer_id, quote_type, status, total_amount, created_at FROM quotes WHERE id = $1`, [req.params.quoteId]);
    if (!quoteRows[0]) return res.status(404).json({ error: "Quote not found." });
    const { rows: lineItems } = await pool.query(
      `SELECT qli.id, qli.qty, qli.unit_price, qli.discount_percent, qli.discounted_unit_price, qli.line_total,
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
