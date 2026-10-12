-- 1.7.0: el tema de la casa (moneda) pasa a ser el de todos; los de serie anteriores, desactivados por ahora.
UPDATE profiles SET theme_id = 'moneda' WHERE theme_id IN ('steam', 'ps5', 'xbox', 'switch', 'cinema', 'retro');
