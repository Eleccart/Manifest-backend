CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  phone_number VARCHAR(10) UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS otp_requests (
  id BIGSERIAL PRIMARY KEY,
  phone_number VARCHAR(10) NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_requests_phone ON otp_requests (phone_number, created_at DESC);
CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
CREATE TABLE IF NOT EXISTS brands (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS product_families (
  id BIGSERIAL PRIMARY KEY,
  brand_id BIGINT NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (brand_id, name)
);
CREATE TABLE IF NOT EXISTS price_list_items (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES categories (id),
  brand_id BIGINT NOT NULL REFERENCES brands (id),
  family_id BIGINT REFERENCES product_families (id),
  sku TEXT,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  source_doc_url TEXT,
  created_by BIGINT REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_list_items_lookup ON price_list_items (category_id, brand_id, family_id);
CREATE TABLE IF NOT EXISTS requirement_scans (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id),
  source_type TEXT NOT NULL CHECK (source_type IN ('scan', 'upload')),
  raw_file_url TEXT,
  ocr_raw_text TEXT,
  status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured', 'reviewed', 'brand_assigned', 'quoted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scan_items (
  id BIGSERIAL PRIMARY KEY,
  scan_id BIGINT NOT NULL REFERENCES requirement_scans (id) ON DELETE CASCADE,
  category_id BIGINT REFERENCES categories (id),
  name TEXT NOT NULL,
  qty TEXT,
  unit TEXT,
  ocr_confidence TEXT NOT NULL DEFAULT 'ok' CHECK (ocr_confidence IN ('ok', 'check')),
  edited_by_user BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_scan_items_scan ON scan_items (scan_id);
CREATE TABLE IF NOT EXISTS category_brand_assignments (
  id BIGSERIAL PRIMARY KEY,
  scan_id BIGINT NOT NULL REFERENCES requirement_scans (id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES categories (id),
  brand_id BIGINT NOT NULL REFERENCES brands (id),
  family_id BIGINT REFERENCES product_families (id),
  UNIQUE (scan_id, category_id)
);
CREATE TABLE IF NOT EXISTS item_brand_overrides (
  id BIGSERIAL PRIMARY KEY,
  scan_item_id BIGINT UNIQUE NOT NULL REFERENCES scan_items (id) ON DELETE CASCADE,
  brand_id BIGINT NOT NULL REFERENCES brands (id),
  family_id BIGINT REFERENCES product_families (id)
);
CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone_number VARCHAR(10),
  email TEXT,
  is_b2b BOOLEAN NOT NULL DEFAULT false,
  business_name TEXT,
  gstin VARCHAR(15),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quotes (
  id BIGSERIAL PRIMARY KEY,
  scan_id BIGINT NOT NULL REFERENCES requirement_scans (id),
  customer_id BIGINT REFERENCES customers (id),
  quote_type TEXT NOT NULL CHECK (quote_type IN ('default', 'customer')),
  status TEXT NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quote_line_items (
  id BIGSERIAL PRIMARY KEY,
  quote_id BIGINT NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
  price_list_item_id BIGINT REFERENCES price_list_items (id),
  qty NUMERIC(12, 2) NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL
);
