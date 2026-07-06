UPDATE categories SET name = 'Wires and Cables' WHERE name = 'Wires & Cables';
UPDATE categories SET name = 'Switch Socket' WHERE name = 'Switches & Accessories';
UPDATE categories SET name = 'MCB DB' WHERE name = 'MCBs & Protection';
UPDATE categories SET name = 'Electrical Accessories' WHERE name = 'Basic Accessories';
INSERT INTO categories (name) VALUES ('Lighting'), ('Home Appliances'), ('Pumps'), ('Stabilizers'), ('Fans') ON CONFLICT (name) DO NOTHING;
