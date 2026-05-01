-- 20260501_residco_master_fleet_fields.sql
--
-- Purpose:
--   Add the columns needed to ingest the RESIDCO Master Car List workbook
--   (Sheet1, 26 columns) on a per-railcar basis. All adds are idempotent
--   (IF NOT EXISTS) so this script is safe to re-run.
--
-- Workbook columns mapped to railcars columns:
--   Car Number               -> car_number              (existing)
--   Rider ID                 -> rider_external_id       (text, NEW — preserves the workbook's external rider key, e.g. "EA1503")
--   Lessee                   -> lessee_name             (text, NEW)
--   Entity                   -> entity                  (existing — RAW value, e.g. "Main", "Rail Partners Select", "Coal")
--   Active                   -> active_status           (text, NEW — raw "Active"/"Inactive" string from sheet)
--                              + active                 (existing boolean — derived)
--   Data Source              -> data_source             (text, NEW)
--   Car Type                 -> car_type                (existing)
--   Description              -> general_description     (existing — also mirrored in `description` column for UI compat)
--   Assignment               -> assignment_label        (text, NEW — free-text assignment string)
--   Lease Type               -> lease_type              (existing)
--   Start Date               -> lease_start_date        (date,  NEW)
--   End Date                 -> lease_end_date          (date,  NEW)
--   Lease Expiry             -> lease_expiry            (date,  NEW — may differ from end_date for renewals)
--   NBV Per Car ($)          -> nbv                     (numeric)
--   OEC Per Car ($)          -> oec                     (numeric)
--   Monthly Rent P/C ($)     -> monthly_rent_per_car    (numeric, NEW)
--   Monthly Depr P/C ($)     -> monthly_depr_per_car    (numeric, NEW)
--   Total BV — Rider ($)     -> total_bv_rider          (numeric, NEW — denormalized rider-level value, retained per-row)
--   Cars on Rider (AR)       -> cars_on_rider_ar        (integer, NEW — denormalized rider-level count)
--   Commodity Family         -> commodity_family        (text, NEW)
--   Commodity                -> commodity               (text, NEW)
--   Build Year               -> build_year              (integer)
--   Lining                   -> lining                  (text)
--   Mech Desig.              -> mechanical_designation  (existing)
--   DOT Code                 -> dot_code                (text, NEW — mirrored to existing dot_specification for compat)
--   Comment / Event Note     -> comment_event_note      (text, NEW)
--
-- Derived field:
--   managed_category — set by trigger from `entity`:
--     'Main'                 -> 'RESIDCO Owned'
--     'Rail Partners Select' -> 'RPS'
--     'Coal'                 -> 'Coal'
--     anything else          -> entity (preserved as-is)
--   The raw `entity` column is always preserved.

BEGIN;

-- ---- Column adds (idempotent) ----------------------------------------------
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS rider_external_id      text;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS lessee_name            text;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS active_status          text;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS data_source            text;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS assignment_label       text;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS lease_start_date       date;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS lease_end_date         date;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS lease_expiry           date;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS monthly_rent_per_car   numeric(14,2);
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS monthly_depr_per_car   numeric(14,2);
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS total_bv_rider         numeric(16,2);
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS cars_on_rider_ar       integer;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS commodity_family       text;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS commodity              text;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS build_year             integer;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS lining                 text;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS dot_code               text;
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS comment_event_note     text;

-- description is a UI-visible alias often used in code; keep both columns in sync via simple
-- nullable mirror. The general_description column (existing) is canonical; this is a copy.
ALTER TABLE railcars ADD COLUMN IF NOT EXISTS description            text;

-- ---- Uniqueness on car_number (defensive — many imports rely on it) -------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'railcars_car_number_unique_idx'
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX railcars_car_number_unique_idx ON railcars (car_number)';
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Could not create unique index on car_number — duplicates exist. Resolve before retrying.';
    END;
  END IF;
END $$;

-- ---- Helpful lookup indexes (optional, low-cost) ---------------------------
CREATE INDEX IF NOT EXISTS railcars_entity_idx              ON railcars (entity);
CREATE INDEX IF NOT EXISTS railcars_managed_category_idx    ON railcars (managed_category);
CREATE INDEX IF NOT EXISTS railcars_rider_external_id_idx   ON railcars (rider_external_id);
CREATE INDEX IF NOT EXISTS railcars_commodity_idx           ON railcars (commodity);
CREATE INDEX IF NOT EXISTS railcars_build_year_idx          ON railcars (build_year);

-- ---- Trigger to derive managed_category from entity ------------------------
CREATE OR REPLACE FUNCTION railcars_derive_managed_category() RETURNS trigger AS $$
BEGIN
  -- Always derive from raw entity, preserving entity unchanged.
  IF NEW.entity IS NULL THEN
    NEW.managed_category := COALESCE(NEW.managed_category, NULL);
  ELSIF NEW.entity = 'Main' THEN
    NEW.managed_category := 'RESIDCO Owned';
  ELSIF NEW.entity = 'Rail Partners Select' THEN
    NEW.managed_category := 'RPS';
  ELSIF NEW.entity = 'Coal' THEN
    NEW.managed_category := 'Coal';
  ELSE
    -- Unknown entity — leave whatever value is provided (or fall back to entity itself
    -- so legacy records aren't silently blanked on update).
    NEW.managed_category := COALESCE(NEW.managed_category, NEW.entity);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS railcars_derive_managed_category_trg ON railcars;
CREATE TRIGGER railcars_derive_managed_category_trg
  BEFORE INSERT OR UPDATE OF entity ON railcars
  FOR EACH ROW EXECUTE FUNCTION railcars_derive_managed_category();

-- One-shot backfill for existing rows.
UPDATE railcars
   SET managed_category = CASE
     WHEN entity = 'Main'                 THEN 'RESIDCO Owned'
     WHEN entity = 'Rail Partners Select' THEN 'RPS'
     WHEN entity = 'Coal'                 THEN 'Coal'
     WHEN entity IS NOT NULL              THEN entity
     ELSE managed_category
   END
 WHERE managed_category IS DISTINCT FROM CASE
     WHEN entity = 'Main'                 THEN 'RESIDCO Owned'
     WHEN entity = 'Rail Partners Select' THEN 'RPS'
     WHEN entity = 'Coal'                 THEN 'Coal'
     WHEN entity IS NOT NULL              THEN entity
     ELSE managed_category
   END;

COMMIT;
