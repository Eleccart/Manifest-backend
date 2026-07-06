const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const { buildQuoteLines } = require("../services/pricing");
const router = express.Router();
router.use(requireAuth);
router.post("/scans/:scanId/quotes", async (req, res, next) => {
  try {
    const { quote_type = "default", customer_id } = req.body || {};
    if (!["default", "customer"].includes(quote_type)) return res.status(400).json({ error: "quote_type must be 'default' or 'customer'." });
    if (quote_type === "customer" && !customer_id) return res.status(400).json({ error: "customer_id is required for a customer quote." });
    const { rows: scanRows } = await pool.query(`SELECT id, status FROM requirement_scans WHERE id = $1 AND user_id = $2`, [req.params.scanId, req.user.id]);
    const scan = scanRows[0];
    if (!scan) return res.status(404).json({ error: "Scan not found." });
    if (!["brand_assigned", "quoted"].includes(scan.status)) return res.status(400).json({ error: "Assign brands first (POST /scans/:scanId/complete-brands)." });
    const lines = await buildQuoteLines(scan.id);
    const total = Math.round(lines.reduce((sum, l) => sum + l.line_total, 0) * 100) / 100;
    const { rows: quoteRows } = await pool.query(
      `INSERT INTO quotes (scan_id, customer_id, quote_type, status, total_amount) VALUES ($1, $2, $3, 'draft', $4) RETURNING id, scan_id, customer_id, quote_type, status, total_amount, created_at`,
      [scan.id, customer_id || null, quote_type, total]
    );
    const quote = quoteRows[0];
    const items = [];
    for (const line of lines) {
      const { rows } = await pool.query(
        `INSERT INTO quote_line_items (quote_id, price_list_item_id, scan_item_id, description, unit, qty, unit_price, line_total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, price_list_item_id, scan_item_id, description, unit, qty, unit_price, line_total`,
        [quote.id, line.price_list_item_id, line.scan_item_id, line.description, line.unit, line.qty, line.unit_price, line.line_total]
      );
      items.push({ ...rows[0], matched_description: line.matched_description, needs_price: line.needs_price });
    }
    await pool.query(`UPDATE requirement_scans SET status = 'quoted' WHERE id = $1`, [scan.id]);
    res.status(201).json({ quote, items, needsPriceCount: items.filter((l) => !l.price_list_item_id).length });
  } catch (err) { next(err); }
});
router.get("/quotes", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT q.id, q.scan_id, q.customer_id, c.name AS customer_name, q.quote_type, q.status, q.total_amount, q.created_at FROM quotes q JOIN requirement_scans rs ON rs.id = q.scan_id LEFT JOIN customers c ON c.id = q.customer_id WHERE rs.user_id = $1 ORDER BY q.created_at DESC`,
      [req.user.id]
    );
    res.json({ quotes: rows });
  } catch (err) { next(err); }
});
router.get("/quotes/:id", async (req, res, next) => {
  try {
    const { rows: quoteRows } = await pool.query(
      `SELECT q.id, q.scan_id, q.customer_id, c.name AS customer_name, q.quote_type, q.status, q.total_amount, q.created_at FROM quotes q JOIN requirement_scans rs ON rs.id = q.scan_id LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = $1 AND rs.user_id = $2`,
      [req.params.id, req.user.id]
    );
    const quote = quoteRows[0];
    if (!quote) return res.status(404).json({ error: "Quote not found." });
    const { rows: items } = await pool.query(
      `SELECT li.id, li.price_list_item_id, li.scan_item_id, li.description, li.unit, li.qty, li.unit_price, li.line_total, pli.description AS matched_description FROM quote_line_items li LEFT JOIN price_list_items pli ON pli.id = li.price_list_item_id WHERE li.quote_id = $1 ORDER BY li.id`,
      [quote.id]
    );
    res.json({ quote, items: items.map((l) => ({ ...l, needs_price: !l.price_list_item_id })) });
  } catch (err) { next(err); }
});
router.patch("/quotes/:quoteId/items/:lineId", async (req, res, next) => {
  try {
    const { qty, unit_price } = req.body || {};
    if (qty === undefined && unit_price === undefined) return res.status(400).json({ error: "Provide qty and/or unit_price." });
    const { rows } = await pool.query(
      `UPDATE quote_line_items li SET qty = COALESCE($1::numeric, li.qty), unit_price = COALESCE($2::numeric, li.unit_price), line_total = ROUND(COALESCE($1::numeric, li.qty) * COALESCE($2::numeric, li.unit_price), 2) FROM quotes q JOIN requirement_scans rs ON rs.id = q.scan_id WHERE li.id = $3 AND li.quote_id = $4 AND q.id = li.quote_id AND rs.user_id = $5 RETURNING li.id, li.description, li.unit, li.qty, li.unit_price, li.line_total`,
      [qty, unit_price, req.params.lineId, req.params.quoteId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Quote line not found." });
    const { rows: totalRows } = await pool.query(
      `UPDATE quotes SET total_amount = (SELECT COALESCE(SUM(line_total), 0) FROM quote_line_items WHERE quote_id = $1) WHERE id = $1 RETURNING total_amount`,
      [req.params.quoteId]
    );
    res.json({ item: rows[0], total_amount: totalRows[0].total_amount });
  } catch (err) { next(err); }
});
module.exports = router;
