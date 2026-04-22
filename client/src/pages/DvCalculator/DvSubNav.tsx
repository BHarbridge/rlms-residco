import { Link, useLocation } from "wouter";
import { Calculator, History as HistoryIcon, Database } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/dv",           label: "New Calculation", icon: Calculator, match: (p: string) => p === "/dv" },
  { href: "/dv/history",   label: "History",         icon: HistoryIcon, match: (p: string) => p.startsWith("/dv/history") },
  { href: "/dv/reference", label: "Reference Data",  icon: Database,   match: (p: string) => p.startsWith("/dv/reference") },
];

export default function DvSubNav() {
  const [location] = useLocation();

  return (
    <div className="border-b border-card-border bg-sidebar/40 px-4 md:px-8">
      <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar" aria-label="DV Calculator sections">
        {tabs.map((t) => {
          const active = t.match(location);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              data-testid={`dv-subnav-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
              className={cn(
                "flex items-center gap-2 px-3 md:px-4 py-2.5 text-xs md:text-sm border-b-2 transition-colors whitespace-nowrap",
                active
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
