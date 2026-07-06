const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const router = express.Router();
router.use(requireAuth);
router.post("/", async (req, res, next) => {
  try {
    const { name, phone_number, email, is_b2b, business_name, gstin } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "name is required." });
    if (phone_number && !/^[6-9]\d{9}$/.test(phone_number)) return res.status(400).json({ error: "Enter a valid 10-digit mobile number." });
    if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) return res.status(400).json({ error: "GSTIN must be 15 characters (digits and capital letters)." });
    const { rows } = await pool.query(
      `INSERT INTO customers (name, phone_number, email, is_b2b, business_name, gstin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, phone_number, email, is_b2b, business_name, gstin, created_at`,
      [name.trim(), phone_number || null, email || null, Boolean(is_b2b), business_name || null, gstin || null]
    );
    res.status(201).json({ customer: rows[0] });
  } catch (err) { next(err); }
});
router.get("/", async (req, res, next) => {
  try {
    const { q } = req.query;
    if (q) {
      const { rows } = await pool.query(
        `SELECT id, name, phone_number, email, is_b2b, business_name, gstin, created_at FROM customers WHERE name ILIKE $1 OR phone_number LIKE $1 OR business_name ILIKE $1 ORDER BY name LIMIT 50`,
        [`%${q}%`]
      );
      return res.json({ customers: rows });
    }
    const { rows } = await pool.query(`SELECT id, name, phone_number, email, is_b2b, business_name, gstin, created_at FROM customers ORDER BY created_at DESC LIMIT 50`);
    res.json({ customers: rows });
  } catch (err) { next(err); }
});
module.exports = router;
