ALTER TABLE quote_line_items
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discounted_unit_price NUMERIC(12, 2);
CREATE TABLE IF NOT EXISTS category_discounts (
  id BIGSERIAL PRIMARY KEY,
  quote_id BIGINT NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES categories (id),
  discount_percent NUMERIC(5, 2) NOT NULL,
  UNIQUE (quote_id, category_id)
);
CREATE TABLE IF NOT EXISTS item_discount_overrides (
  id BIGSERIAL PRIMARY KEY,
  quote_line_item_id BIGINT UNIQUE NOT NULL REFERENCES quote_line_items (id) ON DELETE CASCADE,
  discount_percent NUMERIC(5, 2) NOT NULL
);
