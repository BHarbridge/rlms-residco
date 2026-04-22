/**
 * useColumnPrefs
 *
 * Persists a user's optional-column visibility set to Supabase via the
 * /api/prefs/columns endpoint.
 *
 * Usage:
 *   const { visibleCols, toggleCol, resetCols, prefsLoaded } =
 *     useColumnPrefs("fleet_registry", DEFAULT_COLS);
 *
 * - `page`         — unique key per view (e.g. "fleet_registry", "all_cars", "lease_rider_cars")
 * - `defaultCols`  — Set<string> of keys that should be on when no saved pref exists
 * - `prefsLoaded`  — true once the initial fetch has resolved (prevents flicker)
 *
 * Save behaviour:
 *   Writes are debounced 800 ms so rapid toggles don't spam the API.
 *   The UI updates instantly (optimistic); the network call happens in the background.
 *   If the user is not logged in or the fetch fails, the local state still works normally.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";

const DEBOUNCE_MS = 800;

// Shared in-memory cache so multiple component instances on the same page
// don't each make their own fetch (e.g. multiple RiderCars in LeaseManagement).
const memCache = new Map<string, Set<string>>();

export function useColumnPrefs(page: string, defaultCols: Set<string>) {
  const { session } = useAuth();
  const [visibleCols, setVisibleCols] = useState<Set<string>>(defaultCols);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether we've already fetched for this page+user combo
  const fetchedRef = useRef(false);

  // ── Load from API on mount (once per page+session) ──────────────────────────
  useEffect(() => {
    if (!session?.access_token || fetchedRef.current) {
      setPrefsLoaded(true);
      return;
    }

    // Check in-memory cache first (handles multi-instance case)
    const cacheKey = `${session.user.id}:${page}`;
    if (memCache.has(cacheKey)) {
      setVisibleCols(memCache.get(cacheKey)!);
      setPrefsLoaded(true);
      fetchedRef.current = true;
      return;
    }

    fetchedRef.current = true;

    fetch(`/api/prefs/columns?page=${encodeURIComponent(page)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.visible_cols != null && Array.isArray(data.visible_cols)) {
          const loaded = new Set<string>(data.visible_cols);
          memCache.set(cacheKey, loaded);
          setVisibleCols(loaded);
        }
        // If null (no saved pref yet), keep the defaultCols
      })
      .catch(() => {
        // Silently fall back to defaults if API is unreachable
      })
      .finally(() => {
        setPrefsLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  // ── Debounced save to API ──────────────────────────────────────────────────
  const persistCols = useCallback(
    (cols: Set<string>) => {
      if (!session?.access_token) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const cacheKey = `${session.user.id}:${page}`;
        memCache.set(cacheKey, cols);
        fetch("/api/prefs/columns", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ page, visible_cols: Array.from(cols) }),
        }).catch(() => {
          // Silently ignore save failures — local state is still correct
        });
      }, DEBOUNCE_MS);
    },
    [session?.access_token, page]
  );

  // ── Toggle a single column ─────────────────────────────────────────────────
  const toggleCol = useCallback(
    (key: string) => {
      setVisibleCols((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persistCols(next);
        return next;
      });
    },
    [persistCols]
  );

  // ── Reset to defaults ──────────────────────────────────────────────────────
  const resetCols = useCallback(() => {
    setVisibleCols(defaultCols);
    persistCols(defaultCols);
  }, [defaultCols, persistCols]);

  // Cleanup debounce timer on unmount
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  return { visibleCols, toggleCol, resetCols, prefsLoaded };
}
