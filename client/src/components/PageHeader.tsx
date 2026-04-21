import { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="px-8 pt-7 pb-5 border-b border-border flex items-end justify-between gap-6 flex-wrap">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
          RLMS
        </div>
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex gap-2 items-center">{actions}</div>}
    </div>
  );
}
