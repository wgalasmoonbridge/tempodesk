export const PROJECT_COLORS = [
  "#4f46e5",
  "#0d9488",
  "#2563eb",
  "#db2777",
  "#ea580c",
  "#65a30d",
  "#0891b2",
  "#7c3aed",
  "#ca8a04",
  "#dc2626",
  "#475569",
  "#059669",
];

export function ColorSwatches({
  value,
  onChange,
  label = "Project color",
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  const colors = PROJECT_COLORS.includes(value)
    ? PROJECT_COLORS
    : [...PROJECT_COLORS, value];
  return (
    <div className="swatches" role="group" aria-label={label}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className="swatch"
          style={{ background: color }}
          aria-label={`Use color ${color}`}
          aria-pressed={value.toLowerCase() === color.toLowerCase()}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}
