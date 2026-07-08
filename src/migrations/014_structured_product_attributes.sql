-- Proper item allocation: pull size/pack out of free-text descriptions into
-- real columns so quote matching stops regex-parsing strings at query time.
ALTER TABLE price_list_items
  ADD COLUMN IF NOT EXISTS size_value NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS size_unit VARCHAR(16),
  ADD COLUMN IF NOT EXISTS pack_qty NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS pack_unit VARCHAR(16);
CREATE INDEX IF NOT EXISTS idx_price_list_items_attrs ON price_list_items (category_id, brand_id, family_id, size_value, pack_qty);
