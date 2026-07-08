const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const upload = require("../middleware/upload");
const vision = require("../services/vision");
const { guessCategory } = require("../services/scanParser");
const router = express.Router();
router.use(requireAuth);
const PRICE_REGEX = /(.+?)[\s\-–—:]*(?:₹|rs\.?|inr)?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*$/i;
function parsePriceLine(text) {
  const match = text.match(PRICE_REGEX);
  if (!match) return { description: text, price: null };
  return { description: match[1].trim(), price: parseFloat(match[2].replace(/,/g, "")) };
}
router.post("/scan", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    if (req.file.mimetype === "application/pdf") return res.status(400).json({ error: "PDF OCR isn't wired up yet for price lists — try a photo, or use POST /price-list/items to enter rows directly." });
    const { lines } = await vision.detectDocumentText(req.file.buffer);
    const [brandResult, categoryResult] = await Promise.all([
      pool.query(`SELECT id, name FROM brands`),
      pool.query(`SELECT id, name FROM categories`),
    ]);
    const categoryByName = new Map(categoryResult.rows.map((c) => [c.name, c]));
    const candidates = lines.map((line) => {
      const lower = line.text.toLowerCase();
      let brand = null;
      for (const b of brandResult.rows) {
        if (lower.includes(b.name.toLowerCase()) && (!brand || b.name.length > brand.name.length)) brand = b;
      }
      const categoryName = guessCategory(line.text);
      const category = (categoryName && categoryByName.get(categoryName)) || null;
      return {
        ...parsePriceLine(line.text),
        confidence: line.confidence,
        brand_guess: brand ? { id: brand.id, name: brand.name } : null,
        category_guess: category ? { id: category.id, name: category.name } : null,
      };
    });
    res.json({ candidates });
  } catch (err) { next(err); }
});
// Best-effort structured-attribute extraction so callers that only pass a
// description (e.g. quick manual entry) still get size_value/pack_qty for
// matching. Explicit fields in the request always win over this.
const SIZE_SQMM = /([0-9]+(?:\.[0-9]+)?)\s*sq\.?\s?mm/i;
const SIZE_AMPS = /([0-9]+(?:\.[0-9]+)?)\s*A\b/i;
const PACK_COIL = /\(?([0-9]+(?:\.[0-9]+)?)\s*m(?:tr)?\s*coil\)?/i;
function deriveAttributes(description) {
  const sqmm = String(description || "").match(SIZE_SQMM);
  if (sqmm) {
    const coil = String(description || "").match(PACK_COIL);
    return {
      size_value: parseFloat(sqmm[1]),
      size_unit: "sqmm",
      pack_qty: coil ? parseFloat(coil[1]) : null,
      pack_unit: coil ? "m" : null,
    };
  }
  const amps = String(description || "").match(SIZE_AMPS);
  if (amps) return { size_value: parseFloat(amps[1]), size_unit: "A", pack_qty: null, pack_unit: null };
  return { size_value: null, size_unit: null, pack_qty: null, pack_unit: null };
}
router.post("/items", async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "items must be a non-empty array." });
    const inserted = [];
    for (const item of items) {
      const { category_id, brand_id, family_id, sku, description, unit, unit_price, is_regular, hsn_code, gst_rate } = item;
      if (!category_id || !brand_id || !description || !unit || unit_price === undefined) return res.status(400).json({ error: "Each item needs category_id, brand_id, description, unit, and unit_price." });
      const derived = deriveAttributes(description);
      const size_value = item.size_value !== undefined ? item.size_value : derived.size_value;
      const size_unit = item.size_unit !== undefined ? item.size_unit : derived.size_unit;
      const pack_qty = item.pack_qty !== undefined ? item.pack_qty : derived.pack_qty;
      const pack_unit = item.pack_unit !== undefined ? item.pack_unit : derived.pack_unit;
      const { rows } = await pool.query(
        `INSERT INTO price_list_items (category_id, brand_id, family_id, sku, description, unit, unit_price, is_regular, hsn_code, gst_rate, size_value, size_unit, pack_qty, pack_unit, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 18.00), $11, $12, $13, $14, $15)
         RETURNING id, category_id, brand_id, family_id, sku, description, unit, unit_price, is_regular, hsn_code, gst_rate, size_value, size_unit, pack_qty, pack_unit`,
        [category_id, brand_id, family_id || null, sku || null, description, unit, unit_price, is_regular === undefined ? true : Boolean(is_regular), hsn_code || null, gst_rate, size_value || null, size_unit || null, pack_qty || null, pack_unit || null, req.user.id]
      );
      inserted.push(rows[0]);
    }
    res.status(201).json({ items: inserted });
  } catch (err) { next(err); }
});
router.get("/items", async (req, res, next) => {
  try {
    const { category_id, brand_id, family_id } = req.query;
    const conditions = [];
    const params = [];
    if (category_id) { params.push(category_id); conditions.push(`pli.category_id = $${params.length}`); }
    if (brand_id) { params.push(brand_id); conditions.push(`pli.brand_id = $${params.length}`); }
    if (family_id) { params.push(family_id); conditions.push(`pli.family_id = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT pli.id, pli.sku, pli.description, pli.unit, pli.unit_price, pli.hsn_code, pli.gst_rate,
              pli.size_value, pli.size_unit, pli.pack_qty, pli.pack_unit, pli.is_regular,
              c.name AS category_name, b.name AS brand_name, pf.name AS family_name, pli.created_at
       FROM price_list_items pli
       JOIN categories c ON c.id = pli.category_id
       JOIN brands b ON b.id = pli.brand_id
       LEFT JOIN product_families pf ON pf.id = pli.family_id
       ${where} ORDER BY c.name, b.name, pli.description`,
      params
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});
router.patch("/items/:id", async (req, res, next) => {
  try {
    const { description, unit, unit_price, hsn_code, gst_rate, sku, size_value, size_unit, pack_qty, pack_unit } = req.body;
    const { rows } = await pool.query(
      `UPDATE price_list_items SET description = COALESCE($1, description), unit = COALESCE($2, unit),
       unit_price = COALESCE($3, unit_price), hsn_code = COALESCE($4, hsn_code), gst_rate = COALESCE($5, gst_rate), sku = COALESCE($6, sku),
       size_value = COALESCE($7, size_value), size_unit = COALESCE($8, size_unit), pack_qty = COALESCE($9, pack_qty), pack_unit = COALESCE($10, pack_unit)
       WHERE id = $11 RETURNING id, category_id, brand_id, family_id, sku, description, unit, unit_price, hsn_code, gst_rate, size_value, size_unit, pack_qty, pack_unit`,
      [description, unit, unit_price, hsn_code, gst_rate, sku, size_value, size_unit, pack_qty, pack_unit, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Price list item not found." });
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});
router.delete("/items/:id", async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM price_list_items WHERE id = $1`, [req.params.id]);
    res.json({ message: "Deleted." });
  } catch (err) { next(err); }
});
module.exports = router;
