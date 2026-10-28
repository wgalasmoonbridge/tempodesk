import type { ReactNode } from "react";
import { Check } from "lucide-react";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "teal" | "danger";
}) {
  const cls =
    tone === "accent"
      ? "badge badge-accent"
      : tone === "teal"
        ? "badge badge-teal"
        : tone === "danger"
          ? "badge badge-danger"
          : "badge";
  return <span className={cls}>{children}</span>;
}

export function BillableBadge({ billable }: { billable: boolean }) {
  if (!billable) return null;
  return (
    <span className="badge badge-billable" title="Billable">
      <Check size={10} aria-hidden="true" />
      Billable
    </span>
  );
}

export function ProjectChip({
  name,
  color,
}: {
  name: string | null | undefined;
  color?: string | null;
}) {
  if (!name) return null;
  return (
    <span className="project-chip" title={name}>
      <span
        className="dot"
        style={{ background: color ?? "var(--accent)" }}
        aria-hidden="true"
      />
      {name}
    </span>
  );
}

export function TagChip({ name, color }: { name: string; color?: string | null }) {
  return (
    <span className="tag-chip">
      {color ? (
        <span className="dot" style={{ background: color }} aria-hidden="true" />
      ) : null}
      {name}
    </span>
  );
}
