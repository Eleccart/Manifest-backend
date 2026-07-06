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
router.post("/items", async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "items must be a non-empty array." });
    const inserted = [];
    for (const item of items) {
      const { category_id, brand_id, family_id, sku, description, unit, unit_price, is_regular } = item;
      if (!category_id || !brand_id || !description || !unit || unit_price === undefined) return res.status(400).json({ error: "Each item needs category_id, brand_id, description, unit, and unit_price." });
      const { rows } = await pool.query(`INSERT INTO price_list_items (category_id, brand_id, family_id, sku, description, unit, unit_price, is_regular, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, category_id, brand_id, family_id, sku, description, unit, unit_price, is_regular`, [category_id, brand_id, family_id || null, sku || null, description, unit, unit_price, is_regular === undefined ? true : Boolean(is_regular), req.user.id]);
      inserted.push(rows[0]);
    }
    res.status(201).json({ items: inserted });
  } catch (err) { next(err); }
});
module.exports = router;
