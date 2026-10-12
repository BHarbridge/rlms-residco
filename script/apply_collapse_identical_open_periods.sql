-- DO NOT RUN until Bruce signs script/preview_collapse_identical_open_periods.sql.
-- This file raises on purpose. Remove the guard block below only after sign-off.
-- One transaction. No deletes. Excludes 23602 / 23603.
-- Sets end_date = start_date, active = false, and a comment on the close row.
-- Rollback: script/rollback_collapse_identical_open_periods.sql using the
-- close_id list saved from the signed preview.

DO $$
BEGIN
  RAISE EXCEPTION
    'Blocked: apply only after Bruce signs the 120-collapse preview. Remove this guard to run.';
END
$$;

BEGIN;

WITH opens AS (
  SELECT
    ah.id,
    ah.railcar_id,
    ah.rider_external_id,
    ah.start_date,
    ah.assignment_id_ext,
    ah.moved_at,
    ah.comment
  FROM public.assignment_history ah
  JOIN public.railcars r ON r.id = ah.railcar_id
  WHERE r.active IS TRUE
    AND r.id NOT IN (23602, 23603)
    AND ah.end_date IS NULL
),
multi AS (
  SELECT railcar_id
  FROM opens
  GROUP BY railcar_id
  HAVING count(*) > 1
),
pairs AS (
  SELECT o.*
  FROM opens o
  JOIN multi m ON m.railcar_id = o.railcar_id
),
identical_cars AS (
  SELECT railcar_id
  FROM pairs
  GROUP BY railcar_id
  HAVING count(DISTINCT concat_ws('|', coalesce(rider_external_id, ''), coalesce(start_date::text, ''))) = 1
),
ranked AS (
  SELECT
    p.*,
    row_number() OVER (
      PARTITION BY p.railcar_id
      ORDER BY
        (p.assignment_id_ext IS NOT NULL AND btrim(p.assignment_id_ext) <> '') DESC,
        p.moved_at DESC NULLS LAST,
        p.id DESC
    ) AS keep_rank
  FROM pairs p
  JOIN identical_cars i ON i.railcar_id = p.railcar_id
),
to_close AS (
  SELECT id, start_date, comment
  FROM ranked
  WHERE keep_rank > 1
)
UPDATE public.assignment_history ah
SET
  end_date = to_close.start_date,
  active = false,
  comment = CASE
    WHEN coalesce(btrim(to_close.comment), '') = '' THEN
      'VCF close-out: collapsed duplicate open period (same rider+start)'
    WHEN to_close.comment LIKE '%collapsed duplicate open period%' THEN
      to_close.comment
    ELSE
      to_close.comment || ' | VCF close-out: collapsed duplicate open period (same rider+start)'
  END
FROM to_close
WHERE ah.id = to_close.id
  AND ah.end_date IS NULL
  AND ah.railcar_id NOT IN (23602, 23603)
RETURNING ah.id AS closed_id, ah.railcar_id, ah.end_date;

-- Re-run Phase 1 test queries (script/preview_phase1_test_queries.sql) before COMMIT.
-- COMMIT;
-- ROLLBACK;
