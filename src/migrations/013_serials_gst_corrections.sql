ALTER TABLE scan_items ADD COLUMN IF NOT EXISTS serial_no INT;
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS apply_gst BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_discount BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS ocr_corrections (
  id BIGSERIAL PRIMARY KEY,
  scan_item_id BIGINT REFERENCES scan_items (id) ON DELETE SET NULL,
  raw_name TEXT,
  corrected_name TEXT,
  raw_qty TEXT,
  corrected_qty TEXT,
  category_id BIGINT REFERENCES categories (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
