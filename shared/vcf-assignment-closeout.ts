/**
 * VCF assignment-history close-out (Phase 1).
 *
 * Same open period = same railcar + rider_external_id + start_date.
 * A null assignment_id_ext and a later filled id are the same period.
 * Does not write railcar_assignments (Phase 2, not approved).
 */

import {
  assignmentHistoryContentEqual,
  assignmentHistoryNaturalKey,
  type AssignmentHistoryPeriodPayload,
} from "./vcf-import";

export type ExistingHistoryRow = AssignmentHistoryPeriodPayload & {
  id: number;
};

export type CloseoutAction =
  | { op: "unchanged"; existingId: number }
  | { op: "update"; existingId: number; payload: AssignmentHistoryPeriodPayload }
  | { op: "insert"; payload: AssignmentHistoryPeriodPayload }
  | { op: "close"; existingId: number; end_date: string | null; comment: string };

export const CLOSE_DUP =
  "VCF close-out: collapsed duplicate open period (same rider+start)";
export const CLOSE_CHANGED =
  "VCF close-out: period changed; closed at incoming start";

export function openPeriodMatchKey(
  railcarId: number,
  riderExternalId: string | null | undefined,
  startDate: string | null | undefined,
): string {
  return `${railcarId}|${String(riderExternalId ?? "").trim()}|${String(startDate ?? "").trim()}`;
}

/** Skip assignment_history writes for remark-retired or already-inactive cars. */
export function skipVcfAssignmentWrites(car: {
  active_source?: string | null;
  active?: boolean | null;
}): boolean {
  if (String(car.active_source ?? "").trim() === "manual") return true;
  return car.active !== true;
}

/** Fields VCF must not write when active_source = manual. */
export const VCF_MANUAL_PROTECTED_RAILCAR_FIELDS = [
  "active",
  "active_status",
  "status",
  "active_source",
] as const;

export function stripManualProtectedRailcarFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...payload };
  for (const key of VCF_MANUAL_PROTECTED_RAILCAR_FIELDS) {
    delete out[key];
  }
  return out;
}

function appendComment(existing: string | null | undefined, note: string): string {
  const cur = String(existing ?? "").trim();
  if (!cur) return note;
  if (cur.includes(note)) return cur;
  return `${cur} | ${note}`;
}

function isOpen(row: { end_date?: string | null }): boolean {
  return row.end_date == null || String(row.end_date).trim() === "";
}

function preferFilledThenLater<T extends { assignment_id_ext?: string | null; start_date?: string | null; id?: number }>(
  a: T,
  b: T,
): T {
  const aFilled = a.assignment_id_ext ? 1 : 0;
  const bFilled = b.assignment_id_ext ? 1 : 0;
  if (aFilled !== bFilled) return aFilled > bFilled ? a : b;
  const cmp = String(b.start_date ?? "").localeCompare(String(a.start_date ?? ""));
  if (cmp !== 0) return cmp > 0 ? b : a;
  return (b.id ?? 0) > (a.id ?? 0) ? b : a;
}

/**
 * Plan history writes for one car. Caller applies in one transaction.
 * Incoming closed periods still upsert on the full natural key.
 * Incoming open periods match existing opens by rider+start (not ASSIGNMENT_ID).
 */
export function planVcfAssignmentCloseout(args: {
  existingRows: ExistingHistoryRow[];
  incoming: AssignmentHistoryPeriodPayload[];
}): CloseoutAction[] {
  const { existingRows, incoming } = args;
  const actions: CloseoutAction[] = [];
  const incomingOpen = incoming.filter(isOpen);
  const incomingClosed = incoming.filter((p) => !isOpen(p));
  const existingOpen = existingRows.filter(isOpen);

  const byNatural = new Map<string, ExistingHistoryRow>();
  for (const row of existingRows) {
    byNatural.set(
      assignmentHistoryNaturalKey(
        row.railcar_id,
        row.assignment_id_ext,
        row.start_date,
        row.end_date,
      ),
      row,
    );
  }

  for (const hist of incomingClosed) {
    const key = assignmentHistoryNaturalKey(
      hist.railcar_id,
      hist.assignment_id_ext,
      hist.start_date,
      hist.end_date,
    );
    const existing = byNatural.get(key);
    if (!existing) {
      actions.push({ op: "insert", payload: hist });
      continue;
    }
    if (assignmentHistoryContentEqual(existing, hist)) {
      actions.push({ op: "unchanged", existingId: existing.id });
    } else {
      actions.push({ op: "update", existingId: existing.id, payload: hist });
    }
  }

  if (incomingOpen.length === 0) return actions;

  const incomingByMatch = new Map<string, AssignmentHistoryPeriodPayload>();
  for (const hist of incomingOpen) {
    const matchKey = openPeriodMatchKey(
      hist.railcar_id,
      hist.rider_external_id,
      hist.start_date,
    );
    const prev = incomingByMatch.get(matchKey);
    incomingByMatch.set(matchKey, prev ? preferFilledThenLater(prev, hist) : hist);
  }

  const latestIncomingStart =
    [...incomingOpen]
      .map((p) => String(p.start_date ?? ""))
      .sort()
      .at(-1) || null;

  const claimed = new Set<number>();

  for (const [matchKey, currentOpen] of incomingByMatch) {
    const matches = existingOpen.filter(
      (row) =>
        !claimed.has(row.id) &&
        openPeriodMatchKey(row.railcar_id, row.rider_external_id, row.start_date) ===
          matchKey,
    );
    const keep = [...matches].sort((a, b) => {
      const aFilled = a.assignment_id_ext ? 1 : 0;
      const bFilled = b.assignment_id_ext ? 1 : 0;
      if (aFilled !== bFilled) return bFilled - aFilled;
      return (b.id ?? 0) - (a.id ?? 0);
    })[0];

    for (const row of matches) {
      if (keep && row.id === keep.id) continue;
      claimed.add(row.id);
      actions.push({
        op: "close",
        existingId: row.id,
        end_date: currentOpen.start_date,
        comment: appendComment(row.comment, CLOSE_DUP),
      });
    }

    if (keep) {
      claimed.add(keep.id);
      const merged: AssignmentHistoryPeriodPayload = {
        ...currentOpen,
        assignment_id_ext: currentOpen.assignment_id_ext || keep.assignment_id_ext,
      };
      if (assignmentHistoryContentEqual(keep, merged)) {
        actions.push({ op: "unchanged", existingId: keep.id });
      } else {
        actions.push({ op: "update", existingId: keep.id, payload: merged });
      }
    } else {
      actions.push({ op: "insert", payload: currentOpen });
    }
  }

  for (const row of existingOpen) {
    if (claimed.has(row.id)) continue;
    actions.push({
      op: "close",
      existingId: row.id,
      end_date: latestIncomingStart,
      comment: appendComment(row.comment, CLOSE_CHANGED),
    });
  }

  return actions;
}

export function closeoutStats(actions: CloseoutAction[]): {
  inserted: number;
  updated: number;
  closed: number;
  unchanged: number;
} {
  const stats = { inserted: 0, updated: 0, closed: 0, unchanged: 0 };
  for (const a of actions) {
    if (a.op === "insert") stats.inserted += 1;
    else if (a.op === "update") stats.updated += 1;
    else if (a.op === "close") stats.closed += 1;
    else stats.unchanged += 1;
  }
  return stats;
}

/** Patch written when applying a close action. Never deletes. */
export function closeoutClosePatch(
  action: Extract<CloseoutAction, { op: "close" }>,
  movedAt: string,
): { end_date: string | null; active: false; comment: string; moved_at: string } {
  return {
    end_date: action.end_date,
    active: false,
    comment: action.comment,
    moved_at: movedAt,
  };
}
