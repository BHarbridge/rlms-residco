-- READ ONLY. Phase 2 review table — not approved to close.
-- 66 active cars with more than one open period that differ on rider or start.
-- Bruce signs this (plus the latest VCF current row) before anything closes.
-- Excludes 23602 / 23603. File current columns are left for the latest workbook.

WITH opens AS (
  SELECT
    ah.id,
    ah.railcar_id,
    ah.rider_external_id,
    ah.start_date,
    ah.assignment_id_ext,
    ah.assignment_label,
    ah.moved_at,
    r.reporting_marks,
    r.car_number,
    r.rider_external_id AS car_rider
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
differing AS (
  SELECT railcar_id
  FROM pairs
  GROUP BY railcar_id
  HAVING count(DISTINCT concat_ws('|', coalesce(rider_external_id, ''), coalesce(start_date::text, ''))) > 1
)
SELECT
  p.railcar_id,
  p.reporting_marks,
  p.car_number,
  p.car_rider AS car_current_rider,
  p.id AS history_id,
  p.rider_external_id AS history_rider,
  p.start_date,
  p.assignment_id_ext,
  p.assignment_label,
  p.moved_at,
  NULL::text AS file_current_rider,
  NULL::text AS file_current_start,
  NULL::text AS file_current_assignment_id
FROM pairs p
JOIN differing d ON d.railcar_id = p.railcar_id
ORDER BY p.reporting_marks, p.car_number, p.start_date, p.id;
