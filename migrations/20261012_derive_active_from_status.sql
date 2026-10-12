-- Derive railcars.active and railcars.active_status from railcars.status.
-- Phase 1 (Bruce 2026-10-12): status is the authority.
--   status = 'Active/In-Service' → active true, active_status 'Active'
--   any other non-blank status  → active false, active_status 'Inactive'
-- Does NOT derive fleet_status (Leased / Idle / Sold / Abatement stays independent).
-- Columns remain writable so remark_railcars and VCF keep sending the triad;
-- this trigger overwrites the derived pair from status on the same write.
-- File only in this PR — do not apply to production until the Phase 1 deploy.

CREATE OR REPLACE FUNCTION public.railcars_derive_active_from_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NULL OR btrim(NEW.status) = '' THEN
    RETURN NEW;
  END IF;
  IF btrim(NEW.status) = 'Active/In-Service' THEN
    NEW.active := true;
    NEW.active_status := 'Active';
  ELSE
    NEW.active := false;
    NEW.active_status := 'Inactive';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_railcars_derive_active_from_status ON public.railcars;
CREATE TRIGGER trg_railcars_derive_active_from_status
  BEFORE INSERT OR UPDATE OF status, active, active_status ON public.railcars
  FOR EACH ROW
  EXECUTE FUNCTION public.railcars_derive_active_from_status();

COMMENT ON FUNCTION public.railcars_derive_active_from_status() IS
  'Keep railcars.active / active_status aligned with status. Does not touch fleet_status. Rollback: DROP TRIGGER trg_railcars_derive_active_from_status ON public.railcars; DROP FUNCTION public.railcars_derive_active_from_status();';
