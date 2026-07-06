const pool = require("../db/pool");
async function suggestCategoryDiscount({ categoryId, brandId, familyId, customerId }) {
  if (customerId) {
    const { rows } = await pool.query(
      `SELECT cd.discount_percent FROM category_discounts cd
       JOIN quotes q ON q.id = cd.quote_id
       JOIN category_brand_assignments cba ON cba.scan_id = q.scan_id AND cba.category_id = cd.category_id
       WHERE q.customer_id = $1 AND cd.category_id = $2 AND cba.brand_id = $3
         AND (cba.family_id = $4 OR ($4 IS NULL AND cba.family_id IS NULL))
       ORDER BY q.created_at DESC LIMIT 1`,
      [customerId, categoryId, brandId, familyId || null]
    );
    if (rows[0]) return { discountPercent: Number(rows[0].discount_percent), source: "customer_history" };
  }
  const { rows } = await pool.query(
    `SELECT cd.discount_percent FROM category_discounts cd
     JOIN quotes q ON q.id = cd.quote_id
     JOIN category_brand_assignments cba ON cba.scan_id = q.scan_id AND cba.category_id = cd.category_id
     WHERE cd.category_id = $1 AND cba.brand_id = $2
       AND (cba.family_id = $3 OR ($3 IS NULL AND cba.family_id IS NULL))
     ORDER BY q.created_at DESC LIMIT 1`,
    [categoryId, brandId, familyId || null]
  );
  if (rows[0]) return { discountPercent: Number(rows[0].discount_percent), source: "general_history" };
  return { discountPercent: 0, source: "none" };
}
module.exports = { suggestCategoryDiscount };
