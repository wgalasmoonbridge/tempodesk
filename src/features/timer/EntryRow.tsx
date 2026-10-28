import { Pencil, Play, Trash2 } from "lucide-react";
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
  onResume: (entry: TimeEntry) => void;
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
  onResume,
  onEdit,
  onDelete,
}: EntryRowProps) {
  return (
    <div className={`entry-row${entry.running ? " running" : ""}`}>
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
