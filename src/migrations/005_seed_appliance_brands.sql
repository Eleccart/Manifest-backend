INSERT INTO brands (name) VALUES ('Crompton'), ('Atomberg'), ('Orient'), ('Standard'), ('Luker') ON CONFLICT (name) DO NOTHING;
