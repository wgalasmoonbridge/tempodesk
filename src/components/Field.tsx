import type { ReactNode } from "react";
import { useId } from "react";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const describedBy = hint || error ? `${id}-desc` : undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <span className="field-error" id={describedBy} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint" id={describedBy}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
