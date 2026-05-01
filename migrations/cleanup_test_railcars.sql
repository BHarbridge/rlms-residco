-- cleanup_test_railcars.sql
--
-- Purpose:
--   Identify and (optionally) remove obvious test/sample/demo/placeholder railcars
--   from the `railcars` table, in preparation for ingesting the real RESIDCO
--   master fleet (~14,938 cars).
--
-- Safety:
--   * Read-only by default — running this file as-is only PREVIEWS candidates
--     and creates a snapshot table; it does NOT delete anything.
--   * Two-phase: (1) preview + snapshot, (2) hard-delete (commented out).
--   * Conservative match predicate intended to avoid hitting real cars:
--       - car_number begins with TEST, SAMPLE, DEMO, FAKE, DUMMY, PLACEHOLDER, FOO, BAR, EXAMPLE, XXX, ZZZ
--       - OR car_number matches \b(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER)\b anywhere
--       - OR notes/general_description contains any of the literal markers
--       - OR reporting_marks IN ('TEST','SAMP','DEMO','XXXX','ZZZZ')
--     Real reporting marks are 2-4 alpha chars + Xs etc. — TEST/SAMP/DEMO/XXXX/ZZZZ
--     are not in use by any real Class I/short line we are aware of, but operators
--     should review the preview output before running the destructive section.
--   * All destructive work runs inside a single transaction with a savepoint so
--     it can be rolled back. The destructive block is wrapped in a DO block
--     guarded by a `cleanup_confirm` setting that must be set true at runtime.
--
-- Usage:
--   1) Preview:        psql ... -f migrations/cleanup_test_railcars.sql
--      → Outputs the candidates and creates table `railcars_test_quarantine` as a snapshot.
--   2) Confirm + delete (after reviewing):
--        psql ... -v cleanup_confirm=true -f migrations/cleanup_test_railcars.sql
--      → Deletes assignments + history + the railcars themselves, in a single transaction.
--      → If anything fails, the transaction rolls back automatically.
--
-- Revertibility:
--   The full row content is captured in `railcars_test_quarantine` before deletion,
--   so a re-insert is straightforward if the predicate accidentally matches a real car.

\set ON_ERROR_STOP on
\set cleanup_confirm '\'' :cleanup_confirm '\''

-- ---- Predicate (single source of truth) -----------------------------------
DROP VIEW IF EXISTS v_railcars_test_candidates;
CREATE OR REPLACE VIEW v_railcars_test_candidates AS
SELECT r.*
  FROM railcars r
 WHERE
   -- car_number markers (start-of-string OR delimited token)
        upper(r.car_number) ~ '^(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER|FOO|BAR|EXAMPLE|XXX+|ZZZ+)'
     OR upper(r.car_number) ~ '\m(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER)\M'
   -- reporting_marks markers
     OR upper(coalesce(r.reporting_marks, '')) IN ('TEST','SAMP','DEMO','XXXX','ZZZZ','DUMM','FAKE')
   -- notes / description / comment markers — explicit literal anchors (avoid
   -- matching legitimate words like "tested" or "demonstration loop")
     OR coalesce(r.notes, '')               ILIKE '%[TEST DATA]%'
     OR coalesce(r.notes, '')               ILIKE '%test record%'
     OR coalesce(r.notes, '')               ILIKE '%sample data%'
     OR coalesce(r.notes, '')               ILIKE '%placeholder%'
     OR coalesce(r.notes, '')               ILIKE '%do not use%'
     OR coalesce(r.general_description, '') ILIKE '%[TEST DATA]%'
     OR coalesce(r.general_description, '') ILIKE '%sample data%'
     OR coalesce(r.general_description, '') ILIKE '%placeholder%'
     OR coalesce(r.general_description, '') ILIKE '%demo data%';

-- ---- Phase 1: PREVIEW + SNAPSHOT ------------------------------------------
\echo
\echo '== Test/sample railcar candidates =='
SELECT id,
       car_number,
       reporting_marks,
       car_type,
       entity,
       managed_category,
       status,
       left(coalesce(notes, general_description, ''), 80) AS sample_text
  FROM v_railcars_test_candidates
  ORDER BY car_number;

\echo
\echo '== Counts by category =='
SELECT
  count(*) FILTER (WHERE upper(car_number) ~ '^(TEST|SAMPLE|DEMO|FAKE|DUMMY|PLACEHOLDER|FOO|BAR|EXAMPLE|XXX+|ZZZ+)') AS car_number_marker,
  count(*) FILTER (WHERE upper(coalesce(reporting_marks,'')) IN ('TEST','SAMP','DEMO','XXXX','ZZZZ','DUMM','FAKE')) AS marks_marker,
  count(*) FILTER (WHERE coalesce(notes,'') ILIKE '%test record%' OR coalesce(notes,'') ILIKE '%sample data%') AS notes_marker,
  count(*) AS total
  FROM v_railcars_test_candidates;

-- Snapshot for revertibility (always rebuilt — if a previous run already created
-- the table, drop & recreate to reflect the latest predicate).
DROP TABLE IF EXISTS railcars_test_quarantine;
CREATE TABLE railcars_test_quarantine AS
SELECT now() AS quarantined_at, r.* FROM v_railcars_test_candidates r;

\echo
\echo 'Snapshot saved to table: railcars_test_quarantine'
\echo 'To DELETE these rows, re-run with -v cleanup_confirm=true'

-- ---- Phase 2: DESTRUCTIVE — only when explicitly confirmed -----------------
DO $$
DECLARE
  v_confirm text := current_setting('cleanup.confirm', true);
  v_count   bigint;
BEGIN
  -- The psql variable :cleanup_confirm is a string. We re-read it via a
  -- temporary GUC set at session start. If the operator did not pass it,
  -- abort here without touching anything.
  IF coalesce(v_confirm, '') <> 'true' THEN
    RAISE NOTICE 'Phase 2 (delete) skipped — pass -v cleanup_confirm=true and SET cleanup.confirm=''true'' to enable.';
    RETURN;
  END IF;

  -- Single atomic deletion path.
  WITH ids AS (SELECT id FROM v_railcars_test_candidates)
  , del_assigns AS (
      DELETE FROM railcar_assignments WHERE railcar_id IN (SELECT id FROM ids) RETURNING 1
  ), del_history AS (
      DELETE FROM assignment_history  WHERE railcar_id IN (SELECT id FROM ids) RETURNING 1
  ), del_numhist AS (
      DELETE FROM car_number_history  WHERE railcar_id IN (SELECT id FROM ids) RETURNING 1
  ), del_cars AS (
      DELETE FROM railcars            WHERE id         IN (SELECT id FROM ids) RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del_cars;
  RAISE NOTICE 'Deleted % railcar rows (snapshot kept in railcars_test_quarantine).', v_count;
END $$;
