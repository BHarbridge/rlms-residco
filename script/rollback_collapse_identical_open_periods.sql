-- Rollback for the 120 identical-duplicate collapse.
-- Restores the signed close_id list: end_date NULL, active true.
-- Does not delete anything. Does not touch cars 23602 / 23603.
-- Replace the id list with the close_id column from the signed preview
-- (script/preview_collapse_identical_open_periods.2026-10-12.csv).

DO $$
BEGIN
  RAISE EXCEPTION
    'Blocked: rollback only after a signed apply. Remove this guard and confirm the id list.';
END
$$;

BEGIN;

UPDATE public.assignment_history
SET
  end_date = NULL,
  active = true,
  comment = NULLIF(
    btrim(
      regexp_replace(
        coalesce(comment, ''),
        '( \| )?VCF close-out: collapsed duplicate open period \(same rider\+start\)',
        '',
        'g'
      )
    ),
    ''
  )
WHERE id IN (
  -- paste close_id values from the signed preview
  0
)
  AND railcar_id NOT IN (23602, 23603);

-- COMMIT;
-- ROLLBACK;
