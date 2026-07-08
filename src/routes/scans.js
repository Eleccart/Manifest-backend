const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const upload = require("../middleware/upload");
const vision = require("../services/vision");
const { parseRequirementLines } = require("../services/scanParser");
const { structureWithLlm } = require("../services/llmParser");
const router = express.Router();
router.use(requireAuth);
router.post("/", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const sourceType = req.body.source_type === "upload" ? "upload" : "scan";
    if (req.file.mimetype === "application/pdf") {
      const { rows } = await pool.query(`INSERT INTO requirement_scans (user_id, source_type, status) VALUES ($1, $2, 'captured') RETURNING id, status, created_at`, [req.user.id, sourceType]);
      return res.status(201).json({ scan: rows[0], items: [], warning: "PDF text extraction isn't wired up yet — add items manually in review." });
    }
    const { rawText, lines } = await vision.detectDocumentText(req.file.buffer);
    const catResult = await pool.query(`SELECT id, name FROM categories`);
    const categoryIdByName = new Map(catResult.rows.map((c) => [c.name, c.id]));
    let parsed;
    let parser = "regex";
    const llmItems = await structureWithLlm(rawText, catResult.rows.map((c) => c.name));
    if (llmItems && llmItems.length > 0) {
      parser = "llm";
      parsed = llmItems.map((p) => ({ serial: p.serial, name: p.name, qty: p.qty, unit: null, category: p.category, confidence: "ok" }));
    } else {
      parsed = parseRequirementLines(lines).map((p, i) => ({ serial: i + 1, ...p }));
    }
    const scanResult = await pool.query(`INSERT INTO requirement_scans (user_id, source_type, ocr_raw_text, status) VALUES ($1, $2, $3, 'captured') RETURNING id, status, created_at`, [req.user.id, sourceType, rawText]);
    const scan = scanResult.rows[0];
    const items = [];
    for (const item of parsed) {
      const categoryId = (item.category && categoryIdByName.get(item.category)) || null;
      const { rows } = await pool.query(`INSERT INTO scan_items (scan_id, category_id, name, qty, unit, ocr_confidence, serial_no) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, category_id, name, qty, unit, ocr_confidence, edited_by_user, serial_no`, [scan.id, categoryId, item.name, item.qty, item.unit, item.confidence, item.serial]);
      items.push(rows[0]);
    }
    res.status(201).json({ scan, items, parser });
  } catch (err) { next(err); }
});
router.get("/:id", async (req, res, next) => {
  try {
    const scanResult = await pool.query(`SELECT id, user_id, source_type, status, created_at FROM requirement_scans WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    const scan = scanResult.rows[0];
    if (!scan) return res.status(404).json({ error: "Scan not found." });
    const itemsResult = await pool.query(`SELECT si.id, si.serial_no, si.name, si.qty, si.unit, si.ocr_confidence, si.edited_by_user, c.id AS category_id, c.name AS category_name FROM scan_items si LEFT JOIN categories c ON c.id = si.category_id WHERE si.scan_id = $1 ORDER BY si.serial_no NULLS LAST, si.id`, [scan.id]);
    res.json({ scan, items: itemsResult.rows });
  } catch (err) { next(err); }
});
router.patch("/:id/items/:itemId", async (req, res, next) => {
  try {
    const { name, qty, unit, category_id } = req.body;
    const { rows: currentRows } = await pool.query(`SELECT id, name, qty, category_id FROM scan_items WHERE id = $1 AND scan_id = $2`, [req.params.itemId, req.params.id]);
    const current = currentRows[0];
    if (!current) return res.status(404).json({ error: "Item not found on this scan." });
    const { rows } = await pool.query(`UPDATE scan_items SET name = COALESCE($1, name), qty = COALESCE($2, qty), unit = COALESCE($3, unit), category_id = COALESCE($4, category_id), edited_by_user = true WHERE id = $5 AND scan_id = $6 RETURNING id, serial_no, name, qty, unit, category_id, ocr_confidence, edited_by_user`, [name, qty, unit, category_id, req.params.itemId, req.params.id]);
    const updated = rows[0];
    const nameChanged = name !== undefined && name !== null && name !== current.name;
    const qtyChanged = qty !== undefined && qty !== null && String(qty) !== String(current.qty);
    if (nameChanged || qtyChanged) {
      await pool.query(
        `INSERT INTO ocr_corrections (scan_item_id, raw_name, corrected_name, raw_qty, corrected_qty, category_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [current.id, current.name, updated.name, current.qty, updated.qty, updated.category_id || current.category_id]
      );
    }
    res.json({ item: updated });
  } catch (err) { next(err); }
});
router.post("/:id/complete-review", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`UPDATE requirement_scans SET status = 'reviewed' WHERE id = $1 AND user_id = $2 RETURNING id, status`, [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "Scan not found." });
    res.json({ scan: rows[0] });
  } catch (err) { next(err); }
});
module.exports = router;
