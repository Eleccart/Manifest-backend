ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS scan_item_id BIGINT REFERENCES scan_items (id) ON DELETE SET NULL;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE quote_line_items ADD COLUMN IF NOT EXISTS unit TEXT;
