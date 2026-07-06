const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const router = express.Router();
router.get("/categories", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT id, name FROM categories ORDER BY name`);
    res.json({ categories: rows });
  } catch (err) { next(err); }
});
router.get("/brands", async (req, res, next) => {
  try {
    const { category_id } = req.query;
    if (!category_id) {
      const { rows } = await pool.query(`SELECT id, name FROM brands ORDER BY name`);
      return res.json({ brands: rows });
    }
    const { rows } = await pool.query(`SELECT DISTINCT b.id, b.name FROM brands b JOIN price_list_items pli ON pli.brand_id = b.id WHERE pli.category_id = $1 ORDER BY b.name`, [category_id]);
    if (rows.length === 0) {
      const fallback = await pool.query(`SELECT id, name FROM brands ORDER BY name`);
      return res.json({ brands: fallback.rows, fallback: true });
    }
    res.json({ brands: rows });
  } catch (err) { next(err); }
});
router.get("/brands/:id/families", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT id, name FROM product_families WHERE brand_id = $1 ORDER BY name`, [req.params.id]);
    res.json({ families: rows });
  } catch (err) { next(err); }
});
router.use(requireAuth);
router.put("/scans/:scanId/categories/:categoryId/brand", async (req, res, next) => {
  try {
    const { brand_id, family_id } = req.body;
    if (!brand_id) return res.status(400).json({ error: "brand_id is required." });
    const { rows } = await pool.query(`INSERT INTO category_brand_assignments (scan_id, category_id, brand_id, family_id) VALUES ($1, $2, $3, $4) ON CONFLICT (scan_id, category_id) DO UPDATE SET brand_id = EXCLUDED.brand_id, family_id = EXCLUDED.family_id RETURNING id, scan_id, category_id, brand_id, family_id`, [req.params.scanId, req.params.categoryId, brand_id, family_id || null]);
    res.json({ assignment: rows[0] });
  } catch (err) { next(err); }
});
router.put("/scans/:scanId/items/:itemId/brand-override", async (req, res, next) => {
  try {
    const { brand_id, family_id } = req.body;
    if (!brand_id) return res.status(400).json({ error: "brand_id is required." });
    const { rows } = await pool.query(`INSERT INTO item_brand_overrides (scan_item_id, brand_id, family_id) VALUES ($1, $2, $3) ON CONFLICT (scan_item_id) DO UPDATE SET brand_id = EXCLUDED.brand_id, family_id = EXCLUDED.family_id RETURNING id, scan_item_id, brand_id, family_id`, [req.params.itemId, brand_id, family_id || null]);
    res.json({ override: rows[0] });
  } catch (err) { next(err); }
});
router.delete("/scans/:scanId/items/:itemId/brand-override", async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM item_brand_overrides WHERE scan_item_id = $1`, [req.params.itemId]);
    res.json({ message: "Override removed." });
  } catch (err) { next(err); }
});
router.post("/scans/:scanId/complete-brands", async (req, res, next) => {
  try {
    const { rows: categoryRows } = await pool.query(`SELECT DISTINCT category_id FROM scan_items WHERE scan_id = $1 AND category_id IS NOT NULL`, [req.params.scanId]);
    const { rows: assignedRows } = await pool.query(`SELECT category_id FROM category_brand_assignments WHERE scan_id = $1`, [req.params.scanId]);
    const assignedIds = new Set(assignedRows.map((r) => r.category_id));
    const missing = categoryRows.filter((r) => !assignedIds.has(r.category_id));
    if (missing.length > 0) return res.status(400).json({ error: "Every category needs a brand before continuing.", missingCategoryIds: missing.map((m) => m.category_id) });
    const { rows } = await pool.query(`UPDATE requirement_scans SET status = 'brand_assigned' WHERE id = $1 RETURNING id, status`, [req.params.scanId]);
    res.json({ scan: rows[0] });
  } catch (err) { next(err); }
});
module.exports = router;
