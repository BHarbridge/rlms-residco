-- Phase 1 test queries (read only). Run before and after the signed 120-collapse.
-- Cars 23602 and 23603 are excluded from every cleanup count.

-- 1. Status triad mismatch. Must stay 0.
SELECT count(*) AS mismatch_rows
FROM public.v_railcar_active_status_mismatch;

-- 2. Active cars with more than one open assignment_history period.
-- Before 120-collapse: 186. After 120-collapse: 66. After the 66 + importer: 0.
SELECT count(*) AS active_cars_multi_open
FROM (
  SELECT ah.railcar_id
  FROM public.assignment_history ah
  JOIN public.railcars r ON r.id = ah.railcar_id
  WHERE r.active IS TRUE
    AND r.id NOT IN (23602, 23603)
    AND ah.end_date IS NULL
  GROUP BY ah.railcar_id
  HAVING count(*) > 1
) s;

-- 3. Cursor test (c): exactly one open history period whose rider disagrees
-- with railcar_assignments (exclude SOLD). Production 2026-10-12 = 5 TFOX
-- OL1503-vs-EA1503 cars plus TEST 999012 if present. Claude's looser
-- "lease is EA1503" match is a different set — see docs/VCF_CLOSEOUT_PHASE1.md.
WITH one_open AS (
  SELECT ah.railcar_id
  FROM public.assignment_history ah
  JOIN public.railcars r ON r.id = ah.railcar_id
  WHERE r.active IS TRUE
    AND r.id NOT IN (23602, 23603)
    AND ah.end_date IS NULL
  GROUP BY ah.railcar_id
  HAVING count(*) = 1
)
SELECT
  r.id,
  r.reporting_marks,
  r.car_number,
  ah.rider_external_id AS hist_rider,
  ra.sub_lease_number,
  rd.rider_name
FROM one_open o
JOIN public.railcars r ON r.id = o.railcar_id
JOIN public.assignment_history ah
  ON ah.railcar_id = r.id AND ah.end_date IS NULL
JOIN public.railcar_assignments ra ON ra.id::text = r.current_assignment_id
LEFT JOIN public.riders rd ON rd.id = ra.rider_id
WHERE coalesce(ah.rider_external_id, '') <> 'SOLD'
  AND coalesce(ra.sub_lease_number, '') <> 'SOLD'
  AND coalesce(rd.rider_name, '') <> 'SOLD'
  AND coalesce(ah.rider_external_id, '')
        IS DISTINCT FROM coalesce(rd.rider_name, ra.sub_lease_number, '')
  AND coalesce(ah.rider_external_id, '')
        IS DISTINCT FROM coalesce(ra.sub_lease_number, '')
ORDER BY r.reporting_marks, r.car_number;

-- 4. Confirm the VCF natural-key unique index is still absent (repo file
-- migrations/20260813_vcf_history_natural_keys.sql was never applied).
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'assignment_history'
ORDER BY indexname;
