import { Link, useLocation, useLocation as useWouterLocation } from "wouter";
import residcoGlobePath from "@assets/residco-globe.svg";
import { ReactNode, useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard,
  Train,
  List,
  FileText,
  ArrowRightLeft,
  History,
  Search,
  Upload,
  ChevronLeft,
  ChevronRight,
  Users,
  LogOut,
  ShieldCheck,
  Eye,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const mainNav = [
  { href: "/",         label: "Dashboard",       icon: LayoutDashboard },
  { href: "/fleet",    label: "Fleet Registry",   icon: Train },
  { href: "/all-cars", label: "All Railcars",     icon: List },
  { href: "/leases",   label: "Lease Management", icon: FileText },
  { href: "/move",     label: "Move Cars",        icon: ArrowRightLeft },
  { href: "/history",  label: "History",          icon: History },
  { href: "/search",   label: "Search",           icon: Search },
  { href: "/import",   label: "Bulk Import",      icon: Upload },
];

const adminNav = [
  { href: "/users", label: "Users", icon: Users },
];

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn(
      "flex items-center border-b border-sidebar-border transition-all",
      collapsed ? "justify-center px-2 py-3" : "gap-3 px-3 py-3"
    )}>
      <img
        src={residcoGlobePath}
        alt="RESIDCO globe emblem"
        className="shrink-0"
        style={{
          width:  collapsed ? 34 : 40,
          height: collapsed ? 22 : 26,
          objectFit: "contain",
        }}
        draggable={false}
      />
      {!collapsed && (
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight leading-tight text-foreground">
            RLMS
          </div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground leading-tight">
            RESIDCO
          </div>
        </div>
      )}
    </div>
  );
}

function GlobalSearchBar() {
  const [, navigate] = useWouterLocation();
  const [location] = useLocation();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isSearchPage = location.startsWith("/search");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const commit = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    },
    [navigate]
  );

  return (
    <div className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(value);
        }}
        placeholder="Search cars, lessees, riders…"
        className="w-full bg-sidebar-accent/40 border border-sidebar-border rounded-md pl-8 pr-20 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-sidebar-border bg-muted/30 px-1 py-0.5 text-[10px] text-muted-foreground font-sans">
          <span className="text-[11px]">⌘</span>K
        </kbd>
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  collapsed: boolean;
}) {
  const link = (
    <Link
      href={href}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover-elevate",
        active
          ? "bg-sidebar-accent text-foreground border border-sidebar-accent-border"
          : "text-muted-foreground border border-transparent"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }
  return link;
}

// ── Change Password Dialog ────────────────────────────────────────────────────
function ChangePasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setCurrent(""); setNext(""); setConfirm("");
    setError(null); setSuccess(false); setLoading(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    // Re-authenticate with current password first to verify identity
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData?.session?.user?.email;
    if (email) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (signInErr) {
        setError("Current password is incorrect.");
        setLoading(false);
        return;
      }
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: next });
    setLoading(false);

    if (updateErr) {
      setError(updateErr.message);
    } else {
      setSuccess(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Enter your current password, then choose a new one.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="space-y-4">
            <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-3 text-sm text-emerald-400">
              Password updated successfully.
            </div>
            <Button className="w-full" onClick={handleClose}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="cp-current" className="text-xs">Current password</Label>
              <Input
                id="cp-current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                data-testid="input-current-password"
                className="bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cp-new" className="text-xs">New password</Label>
              <Input
                id="cp-new"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="Min. 8 characters"
                required
                autoComplete="new-password"
                data-testid="input-new-password"
                className="bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cp-confirm" className="text-xs">Confirm new password</Label>
              <Input
                id="cp-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                data-testid="input-confirm-password"
                className="bg-background"
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? "Updating…" : "Update password"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [location] = useLocation();
  const { user, role, signOut, needsPasswordChange, clearNeedsPasswordChange } = useAuth();

  // Auto-open when arriving via a password-reset email link
  useEffect(() => {
    if (needsPasswordChange) {
      setChangePwOpen(true);
      clearNeedsPasswordChange();
    }
  }, [needsPasswordChange, clearNeedsPasswordChange]);

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <ChangePasswordDialog open={changePwOpen} onClose={() => setChangePwOpen(false)} />
      <aside
        className={cn(
          "flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-[64px]" : "w-[224px]"
        )}
        data-testid="sidebar"
      >
        <Logo collapsed={collapsed} />

        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
          {mainNav.map((n) => {
            const active =
              location === n.href ||
              (n.href !== "/" && location.startsWith(n.href));
            return (
              <NavItem
                key={n.href}
                href={n.href}
                label={n.label}
                icon={n.icon}
                active={active}
                collapsed={collapsed}
              />
            );
          })}

          {/* Admin-only section */}
          {role === "admin" && (
            <>
              {!collapsed && (
                <div className="pt-3 pb-1 px-3">
                  <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60">
                    Admin
                  </span>
                </div>
              )}
              {adminNav.map((n) => {
                const active = location.startsWith(n.href);
                return (
                  <NavItem
                    key={n.href}
                    href={n.href}
                    label={n.label}
                    icon={n.icon}
                    active={active}
                    collapsed={collapsed}
                  />
                );
              })}
            </>
          )}
        </nav>

        {/* User info + sign out */}
        <div className="px-2 pb-2 pt-2 border-t border-sidebar-border space-y-1">
          {!collapsed && user && (
            <div className="px-3 py-2 rounded-md bg-muted/20 space-y-1">
              <div className="flex items-center gap-1.5">
                {role === "admin" ? (
                  <ShieldCheck className="h-3 w-3 text-primary shrink-0" />
                ) : (
                  <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {role ?? "—"}
                </span>
              </div>
              <p className="text-[11px] text-foreground truncate">{user.email}</p>
            </div>
          )}

          <button
            onClick={() => setChangePwOpen(true)}
            data-testid="button-change-password"
            className={cn(
              "w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border border-transparent",
              collapsed && "justify-center"
            )}
          >
            <KeyRound className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Change password</span>}
          </button>

          <button
            onClick={signOut}
            data-testid="button-sign-out"
            className={cn(
              "w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border border-transparent",
              collapsed && "justify-center"
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>

          <button
            onClick={() => setCollapsed((c) => !c)}
            data-testid="button-collapse-sidebar"
            className="w-full flex items-center justify-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground hover-elevate border border-transparent"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-6 py-2.5 border-b border-sidebar-border bg-sidebar/60 backdrop-blur-sm shrink-0">
          <GlobalSearchBar />
        </div>
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
