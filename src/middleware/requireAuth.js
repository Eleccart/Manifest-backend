const pool = require("../db/pool");
const { sha256 } = require("../utils/crypto");
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return res.status(401).json({ error: "Missing or malformed Authorization header." });
  const tokenHash = sha256(token);
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.token_hash, u.id AS user_id, u.phone_number, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return res.status(401).json({ error: "Session is invalid or has been logged out." });
  req.session = { id: row.session_id, tokenHash: row.token_hash };
  req.user = { id: row.user_id, phoneNumber: row.phone_number, name: row.name };
  next();
}
module.exports = requireAuth;
