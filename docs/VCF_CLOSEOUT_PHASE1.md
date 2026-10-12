# VCF close-out Phase 1

Bruce approved this phase on 2026-10-12, conditional on signing the 120-collapse
preview before any data write. Phase 2 is **not** approved.

This branch is on `BHarbridge/rlms-residco` because cursor[bot] cannot push to
`RESIDCO/RLMS` (403). The production commit (against `a4ec235`) is
`patches/0001-phase1-vcf-closeout-RESIDCO-RLMS-a4ec235.patch`. See
`patches/README.md`.

## In this PR (code only until the preview is signed)

1. **Python monthly script honors `active_source = 'manual'`.** Urgent and
   independent of the rest. A Python run can no longer revive a car retired by
   a remark. Already-inactive cars also skip assignment-history writes.
2. **Assignment-history close-out** in `POST /api/import/vcf/commit` and
   `script/vcf_monthly_import.py`. Same open period = same car + rider + start
   date. A null `assignment_id_ext` and a later filled id are the same period.
   A changed period closes the old open row at the incoming start and inserts
   the new one. Re-running the same file inserts nothing and changes nothing.
   No `railcar_assignments` / `current_assignment_id` writes.
3. **Trigger** `migrations/20261012_derive_active_from_status.sql` — derive
   `active` / `active_status` from `status`. Does not derive `fleet_status`.
   Columns stay writable. **Not applied to production in this PR.**
4. **120-collapse SQL** — preview, guarded apply, rollback. No deletes.
   Excludes cars 23602 and 23603.

## Do not do yet

- Write `railcar_assignments` or `current_assignment_id` from VCF.
- Enforce “at most one open history period per active car” (log-only first,
  after the 66 are resolved).
- Close the 66 differing duplicates (need a signed per-car review table vs the
  latest Valid Car File). Query: `script/preview_differing_open_periods_66.sql`.
- Mass-close the 38 inactive differing duplicates or the 1,748 open periods on
  inactive cars. Leave frozen.
- Touch cars 23602 / 23603 (OFOX 32115 / 032115) in any cleanup list.

## 120-collapse preview (sign before write)

Query: `script/preview_collapse_identical_open_periods.sql`

Production read 2026-10-12 (no writes):

| | count |
|---|---|
| Active cars with >1 open period (excl. 23602/23603) | 186 |
| Identical rider+start duplicates (this collapse) | 120 |
| Keep rows (all have `assignment_id_ext`) | 120 |
| Close rows | 120 |
| Close rows with null `assignment_id_ext` | 118 |
| Both-filled (keep latest `moved_at`): IARX 531070, OFCX 003449 | 2 |
| Leaked 23602/23603 | 0 |

Example: TFOX 002107 keep id **41074** (`assignment_id_ext` 558, moved 2026-09-11),
close id **32** (null id, moved 2026-08-13), `end_date = start_date` 2026-07-21.

Full result: `script/preview_collapse_identical_open_periods.2026-10-12.csv`

Apply (after sign-off, one transaction): `script/apply_collapse_identical_open_periods.sql`
(raises until the guard is removed). Re-run `script/preview_phase1_test_queries.sql`
before commit. After this collapse, multi-open active cars should be **66**.

Rollback: null `end_date` and restore `active` on the saved close ids
(`script/rollback_collapse_identical_open_periods.sql`). No row is deleted.

## `v_valid_export_rows`

**No change to columns or meaning.** The estimate / RepairSMART rebuild still
reads the same view. After the signed 120-collapse, the duplicate *current*
rows disappear (the closed twin stays in the view as a same-day-ended
historical period). Tell Bruce before any future change to that view.

## 5-versus-9 `OL1503` reconciliation

Section 6 test (c) is: active cars with **exactly one** open history period
whose rider disagrees with `railcar_assignments` (exclude `SOLD`).

Production 2026-10-12, that query returns **5** TFOX cars (088036, 088068,
088069, 088098, 088100) — history `OL1503` vs lease `EA1503`. `TEST 999012`
also matches the SQL if present; it is not a fleet car.

Claude’s looser match (rider name **or** sub-lease number equal to `EA1503`)
is a different rule and a different set. It is not an error in the 5.

SQL: `script/preview_phase1_test_queries.sql` query 3.

## Natural-key unique index

`migrations/20260813_vcf_history_natural_keys.sql` (`uq_assignment_history_vcf_period`)
is **not** in production. Confirmed 2026-10-12: `assignment_history` has only
`assignment_history_pkey`, `idx_assignment_history_railcar`, and
`idx_assignment_history_railcar_period`. It is also absent from the applied
Supabase migration list. Phase 1 does not add it (the 118-car bug is the
reason that index would have been the wrong open-period key).

## Prefixes

No `EX` rows in RLMS cars, history, or riders. Handle `EA`, `xOL`, and `xEA`
as today. `EX` waits on Bruce’s team.

## Monthly import path

Still unanswered whether the monthly run is the API commit or the Python
script. Both paths now share the close-out rules. The Python `active_source`
fix ships regardless.

## Rollback of the importer / trigger

Importer changes revert with a deploy. Drop the trigger to undo status
derivation. Phase 1 cleanup only sets `end_date`, `active`, and a comment on
history rows.
