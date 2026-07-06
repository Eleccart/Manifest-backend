INSERT INTO categories (name) VALUES ('Basic Accessories') ON CONFLICT (name) DO NOTHING;
