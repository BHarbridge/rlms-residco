-- READ ONLY. Preview for the 120 identical-duplicate collapse.
-- Bruce signs this result set before any write.
-- Same open period = same car + rider + start_date.
-- Keep: filled assignment_id_ext, else latest moved_at, else latest id.
-- Close: end_date = start_date (no deletes).
-- Excludes cars 23602 and 23603. Does not list them.
-- Snapshot of this query from production 2026-10-12 is
-- script/preview_collapse_identical_open_periods.2026-10-12.csv

WITH opens AS (
  SELECT
    ah.id,
    ah.railcar_id,
    ah.rider_external_id,
    ah.start_date,
    ah.assignment_id_ext,
    ah.assignment_label,
    ah.active,
    ah.moved_at,
    ah.comment,
    r.reporting_marks,
    r.car_number
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
keep AS (SELECT * FROM ranked WHERE keep_rank = 1),
close AS (SELECT * FROM ranked WHERE keep_rank > 1)
SELECT
  k.railcar_id,
  k.reporting_marks,
  k.car_number,
  k.rider_external_id,
  k.start_date::text AS start_date,
  k.id AS keep_id,
  k.assignment_id_ext AS keep_assignment_id_ext,
  k.moved_at AS keep_moved_at,
  c.id AS close_id,
  c.assignment_id_ext AS close_assignment_id_ext,
  c.moved_at AS close_moved_at,
  c.start_date::text AS close_end_date_will_be
FROM keep k
JOIN close c ON c.railcar_id = k.railcar_id
ORDER BY k.reporting_marks, k.car_number;
