# Apply this Phase 1 work to RESIDCO/RLMS

This workspace repo (`BHarbridge/rlms-residco`) is the May 2026 snapshot.
Production lives at `RESIDCO/RLMS` @ `a4ec235`. cursor[bot] cannot push there
(403), so the production commit is delivered as a patch.

```
cd /path/to/RESIDCO/RLMS
git checkout -b cursor/vcf-closeout-phase1-091d a4ec235
git am patches/0001-phase1-vcf-closeout-RESIDCO-RLMS-a4ec235.patch
```

The same new files also land at their intended paths in this repo so the
planner, preview SQL, and docs can be reviewed here.

Do not apply the 120-collapse SQL or the status trigger to production until
Bruce signs `script/preview_collapse_identical_open_periods.2026-10-12.csv`.
