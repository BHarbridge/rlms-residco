"""VCF assignment-history close-out (Phase 1). Mirrors shared/vcf-assignment-closeout.ts."""

from __future__ import annotations

CLOSE_DUP = "VCF close-out: collapsed duplicate open period (same rider+start)"
CLOSE_CHANGED = "VCF close-out: period changed; closed at incoming start"

VCF_MANUAL_PROTECTED_RAILCAR_FIELDS = (
    "active",
    "active_status",
    "status",
    "active_source",
)


def open_period_match_key(railcar_id, rider_external_id, start_date) -> str:
    return f"{railcar_id}|{str(rider_external_id or '').strip()}|{str(start_date or '').strip()}"


def skip_vcf_assignment_writes(car) -> bool:
    if str(car.get("active_source") or "").strip() == "manual":
        return True
    return car.get("active") is not True


def strip_manual_protected_railcar_fields(payload: dict) -> dict:
    out = dict(payload)
    for key in VCF_MANUAL_PROTECTED_RAILCAR_FIELDS:
        out.pop(key, None)
    return out


def ah_natural_key(railcar_id, assignment_id_ext, start_date, end_date=None) -> str:
    return "|".join(
        [
            str(railcar_id),
            str(assignment_id_ext or "").strip(),
            str(start_date or "").strip(),
            str(end_date or "").strip(),
        ]
    )


def is_open(row) -> bool:
    end = row.get("end_date")
    return end is None or str(end).strip() == ""


def append_comment(existing, note: str) -> str:
    cur = str(existing or "").strip()
    if not cur:
        return note
    if note in cur:
        return cur
    return f"{cur} | {note}"


def content_equal_ah(existing, payload) -> bool:
    fields = (
        "rider_external_id",
        "assignment_label",
        "start_date",
        "end_date",
        "active",
        "comment",
        "assignment_id_ext",
        "reason",
    )
    for f in fields:
        if str(existing.get(f) if existing.get(f) is not None else "") != str(
            payload.get(f) if payload.get(f) is not None else ""
        ):
            return False
    return True


def _prefer_filled_then_later(a, b):
    a_filled = 1 if a.get("assignment_id_ext") else 0
    b_filled = 1 if b.get("assignment_id_ext") else 0
    if a_filled != b_filled:
        return a if a_filled > b_filled else b
    if str(b.get("start_date") or "") > str(a.get("start_date") or ""):
        return b
    if str(b.get("start_date") or "") < str(a.get("start_date") or ""):
        return a
    return b if (b.get("id") or 0) > (a.get("id") or 0) else a


def plan_vcf_assignment_closeout(existing_rows, incoming):
    """Return a list of {op, ...} actions. Never deletes."""
    actions = []
    incoming_open = [p for p in incoming if is_open(p)]
    incoming_closed = [p for p in incoming if not is_open(p)]
    existing_open = [r for r in existing_rows if is_open(r)]

    by_natural = {}
    for row in existing_rows:
        by_natural[
            ah_natural_key(
                row.get("railcar_id"),
                row.get("assignment_id_ext"),
                row.get("start_date"),
                row.get("end_date"),
            )
        ] = row

    for hist in incoming_closed:
        key = ah_natural_key(
            hist.get("railcar_id"),
            hist.get("assignment_id_ext"),
            hist.get("start_date"),
            hist.get("end_date"),
        )
        existing = by_natural.get(key)
        if not existing:
            actions.append({"op": "insert", "payload": hist})
        elif content_equal_ah(existing, hist):
            actions.append({"op": "unchanged", "existing_id": existing["id"]})
        else:
            actions.append({"op": "update", "existing_id": existing["id"], "payload": hist})

    if not incoming_open:
        return actions

    incoming_by_match = {}
    for hist in incoming_open:
        match_key = open_period_match_key(
            hist.get("railcar_id"),
            hist.get("rider_external_id"),
            hist.get("start_date"),
        )
        prev = incoming_by_match.get(match_key)
        incoming_by_match[match_key] = _prefer_filled_then_later(prev, hist) if prev else hist

    latest_incoming_start = None
    starts = sorted(str(p.get("start_date") or "") for p in incoming_open)
    if starts:
        latest_incoming_start = starts[-1] or None

    claimed = set()
    for match_key, current_open in incoming_by_match.items():
        matches = [
            row
            for row in existing_open
            if row["id"] not in claimed
            and open_period_match_key(
                row.get("railcar_id"),
                row.get("rider_external_id"),
                row.get("start_date"),
            )
            == match_key
        ]
        keep = None
        if matches:
            keep = sorted(
                matches,
                key=lambda row: (
                    1 if row.get("assignment_id_ext") else 0,
                    row.get("id") or 0,
                ),
                reverse=True,
            )[0]
        for row in matches:
            if keep is not None and row["id"] == keep["id"]:
                continue
            claimed.add(row["id"])
            actions.append(
                {
                    "op": "close",
                    "existing_id": row["id"],
                    "end_date": current_open.get("start_date"),
                    "comment": append_comment(row.get("comment"), CLOSE_DUP),
                }
            )
        if keep is not None:
            claimed.add(keep["id"])
            merged = dict(current_open)
            merged["assignment_id_ext"] = (
                current_open.get("assignment_id_ext") or keep.get("assignment_id_ext")
            )
            if content_equal_ah(keep, merged):
                actions.append({"op": "unchanged", "existing_id": keep["id"]})
            else:
                actions.append({"op": "update", "existing_id": keep["id"], "payload": merged})
        else:
            actions.append({"op": "insert", "payload": current_open})

    for row in existing_open:
        if row["id"] in claimed:
            continue
        actions.append(
            {
                "op": "close",
                "existing_id": row["id"],
                "end_date": latest_incoming_start,
                "comment": append_comment(row.get("comment"), CLOSE_CHANGED),
            }
        )
    return actions


def closeout_stats(actions):
    stats = {"inserted": 0, "updated": 0, "closed": 0, "unchanged": 0}
    for a in actions:
        op = a["op"]
        if op == "insert":
            stats["inserted"] += 1
        elif op == "update":
            stats["updated"] += 1
        elif op == "close":
            stats["closed"] += 1
        else:
            stats["unchanged"] += 1
    return stats


def status_aligned_to_active_flag(current_status, active: bool) -> str:
    cur = str(current_status or "").strip()
    if active:
        return cur if cur == "Active/In-Service" else "Active/In-Service"
    if cur and cur != "Active/In-Service":
        return cur
    return "Off-Lease"
