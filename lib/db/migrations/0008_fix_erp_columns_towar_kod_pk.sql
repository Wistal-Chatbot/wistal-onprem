-- Seed w migracji 0006 oznaczył `towar_kod` jako część klucza głównego trzech
-- tabel pozycji. To nieprawda i wprowadzało model w błąd, bo z `erp_columns`
-- powstaje opis schematu podawany w prompcie:
--
--   * kolumna pochodzi z LEFT JOIN na CDN.Towary w ekstraktorze synca
--     (repo optima-neon-sync) i z założenia może być NULL-em, a kolumna
--     klucza głównego NULL-em być nie może;
--   * sync robi ON CONFLICT (numer, lp) — klucz jest dwukolumnowy, co
--     potwierdza dedupe ROW_NUMBER() PARTITION BY (TrE_TrNId, TrE_Lp).
--
-- Baza on-prem została poprawiona wprost 2026-08-17; ta migracja istnieje po to,
-- żeby świeża instalacja nie odtworzyła błędu z seeda. Idempotentna.
UPDATE "chatbot"."erp_columns" SET "pk" = false
WHERE "name" = 'towar_kod'
  AND "pk"
  AND "table_key" IN (
    'faktury_sprzedazy_pozycje',
    'faktury_zakupu_pozycje',
    'zamowienia_dostawcy_pozycje'
  );
