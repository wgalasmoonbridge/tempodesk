import type { Tag } from "../lib/types";

interface TagPickerProps {
  tags: Tag[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

export function TagPicker({ tags, selected, onChange, disabled }: TagPickerProps) {
  if (tags.length === 0) {
    return (
      <p className="field-hint" style={{ margin: 0 }}>
        No tags yet. Create tags in the Tags section.
      </p>
    );
  }
  return (
    <div className="tag-picker" role="group" aria-label="Tags">
      {tags.map((tag) => {
        const active = selected.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            className="tag-toggle"
            aria-pressed={active}
            disabled={disabled}
            onClick={() =>
              onChange(
                active
                  ? selected.filter((id) => id !== tag.id)
                  : [...selected, tag.id],
              )
            }
          >
            {tag.color ? (
              <span
                className="dot"
                style={{
                  background: tag.color,
                  display: "inline-block",
                  marginRight: 5,
                }}
                aria-hidden="true"
              />
            ) : null}
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
