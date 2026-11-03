import { Copy, Pencil, Play, Trash2 } from "lucide-react";
import { IconButton } from "../../components/Button";
import { BillableBadge, ProjectChip, TagChip } from "../../components/Badge";
import { entryTimeRange, entryTitle } from "../../lib/format";
import { formatDuration } from "../../lib/time";
import type { TimeEntry, TimeFormat } from "../../lib/types";

interface EntryRowProps {
  entry: TimeEntry;
  segmentSeconds: number;
  timezone: string;
  timeFormat: TimeFormat;
  now: number;
  continuedFromPrevious: boolean;
  continuesNext: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelected: (entry: TimeEntry) => void;
  onResume: (entry: TimeEntry) => void;
  onDuplicate: (entry: TimeEntry) => void;
  onEdit: (entry: TimeEntry) => void;
  onDelete: (entry: TimeEntry) => void;
}

export function EntryRow({
  entry,
  segmentSeconds,
  timezone,
  timeFormat,
  now,
  continuedFromPrevious,
  continuesNext,
  selectionMode,
  selected,
  onToggleSelected,
  onResume,
  onDuplicate,
  onEdit,
  onDelete,
}: EntryRowProps) {
  return (
    <div className={`entry-row${entry.running ? " running" : ""}${selectionMode ? " selecting" : ""}`}>
      {selectionMode ? (
        <label className="entry-select" title={entry.running ? "Stop the timer before selecting it for bulk actions" : "Select entry"}>
          <input
            type="checkbox"
            checked={selected}
            disabled={entry.running}
            aria-label={`Select ${entryTitle(entry)}`}
            onChange={() => onToggleSelected(entry)}
          />
        </label>
      ) : null}
      <div className="entry-main">
        <div className="entry-title" title={entryTitle(entry)}>
          {entryTitle(entry)}
        </div>
        <div className="entry-sub">
          {entry.running ? <span className="badge badge-accent">Running</span> : null}
          <ProjectChip name={entry.projectName} color={entry.projectColor} />
          {entry.clientName ? <span>· {entry.clientName}</span> : null}
          {entry.tags.map((tag) => (
            <TagChip key={tag.id} name={tag.name} color={tag.color} />
          ))}
          <BillableBadge billable={entry.isBillable} />
          {continuedFromPrevious ? <span className="badge">from previous day</span> : null}
          {continuesNext ? <span className="badge">continues</span> : null}
        </div>
      </div>
      <div className="entry-time">{entryTimeRange(entry, timezone, timeFormat, now)}</div>
      <div className="entry-duration" title={`${segmentSeconds} seconds this day`}>
        {segmentSeconds > 0 && segmentSeconds < 60
          ? `${segmentSeconds}s`
          : formatDuration(segmentSeconds, "hm")}
        {entry.running ? <span className="live-dot" style={{ marginLeft: 6 }} /> : null}
      </div>
      <div className="entry-actions">
        <IconButton
          label={`Resume “${entryTitle(entry)}” as a new timer`}
          icon={<Play size={14} aria-hidden="true" />}
          onClick={() => onResume(entry)}
          disabled={entry.running}
        />
        <IconButton
          label={`Duplicate “${entryTitle(entry)}”`}
          icon={<Copy size={14} aria-hidden="true" />}
          onClick={() => onDuplicate(entry)}
          disabled={entry.running}
        />
        <IconButton
          label={`Edit “${entryTitle(entry)}”`}
          icon={<Pencil size={14} aria-hidden="true" />}
          onClick={() => onEdit(entry)}
        />
        <IconButton
          label={`Delete “${entryTitle(entry)}”`}
          icon={<Trash2 size={14} aria-hidden="true" />}
          danger
          onClick={() => onDelete(entry)}
          disabled={entry.running}
        />
      </div>
    </div>
  );
}
