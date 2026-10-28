import { useEffect, useState } from "react";
import { Pencil, Play, Repeat2, Square } from "lucide-react";
import { Button } from "../../components/Button";
import { BillableBadge, ProjectChip, TagChip } from "../../components/Badge";
import { TagPicker } from "../../components/TagPicker";
import { useElapsed } from "../../lib/hooks";
import { formatDuration, formatTime } from "../../lib/time";
import type {
  Project,
  StartTimerInput,
  Tag,
  TimeEntry,
  TimeFormat,
} from "../../lib/types";

interface RunningCardProps {
  active: TimeEntry | null;
  serverNowUtc: number | null;
  todaySeconds: number;
  timezone: string;
  timeFormat: TimeFormat;
  projects: Project[];
  tags: Tag[];
  starting: boolean;
  onStart: (input: StartTimerInput) => void;
  onStop: () => void;
  onEdit: (entry: TimeEntry) => void;
  onSwitch: () => void;
}

export function RunningCard({
  active,
  serverNowUtc,
  todaySeconds,
  timezone,
  timeFormat,
  projects,
  tags,
  starting,
  onStart,
  onStop,
  onEdit,
  onSwitch,
}: RunningCardProps) {
  const elapsed = useElapsed(active?.startAtUtc ?? null, serverNowUtc);
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [billable, setBillable] = useState(false);
  const [billableTouched, setBillableTouched] = useState(false);

  useEffect(() => {
    if (active) {
      setDescription("");
      setSelectedTags([]);
      setBillableTouched(false);
    }
  }, [active]);

  const submit = () => {
    if (starting) return;
    onStart({
      description: description.trim(),
      projectId: projectId || null,
      tagIds: selectedTags,
      isBillable: billable,
    });
  };

  if (active) {
    return (
      <section className="card timer-card" aria-label="Running timer">
        <div className="running-head">
          <span className="live-dot" aria-hidden="true" />
          <strong>Tracking</strong>
          <span>
            started {formatTime(active.startAtUtc, timezone, timeFormat)}
          </span>
          <BillableBadge billable={active.isBillable} />
          <span style={{ marginLeft: "auto" }} className="badge">
            Today {formatDuration(todaySeconds, "hm")}
          </span>
        </div>
        <div className="running-body">
          <div className="running-info">
            <div className="title">{active.description.trim() || "Untitled session"}</div>
            <div className="entry-sub">
              <ProjectChip name={active.projectName} color={active.projectColor} />
              {active.clientName ? <span>· {active.clientName}</span> : null}
              {active.tags.length > 0
                ? active.tags.map((tag) => (
                    <TagChip key={tag.id} name={tag.name} color={tag.color} />
                  ))
                : null}
            </div>
          </div>
          <div className="running-actions">
            <div className="running-timer" aria-label={`Elapsed time ${formatDuration(elapsed, "hms")}`}>
              {formatDuration(elapsed, "hms")}
            </div>
            <Button
              variant="danger"
              icon={<Square size={13} aria-hidden="true" fill="currentColor" />}
              onClick={onStop}
              className="btn-stop"
            >
              Stop
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Pencil size={13} aria-hidden="true" />}
              onClick={() => onEdit(active)}
            >
              Edit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Repeat2 size={13} aria-hidden="true" />}
              onClick={onSwitch}
            >
              New session
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card timer-card" aria-label="Start a timer">
      <form
        className="timer-idle-grid"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div style={{ minWidth: 0 }}>
          <label className="sr-only" htmlFor="timer-description">
            What are you working on?
          </label>
          <input
            id="timer-description"
            className="input timer-description"
            placeholder="What are you working on?"
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
            autoFocus
          />
          <div className="timer-meta-row">
            <label className="sr-only" htmlFor="timer-project">
              Project
            </label>
            <select
              id="timer-project"
              className="select"
              value={projectId}
              onChange={(event) => {
                const value = event.target.value;
                setProjectId(value);
                if (!billableTouched) {
                  const project = projects.find((item) => item.id === value);
                  setBillable(project?.defaultBillable ?? false);
                }
              }}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.clientName ? ` — ${project.clientName}` : ""}
                </option>
              ))}
            </select>

            <label className="check">
              <input
                type="checkbox"
                checked={billable}
                onChange={(event) => {
                  setBillableTouched(true);
                  setBillable(event.target.checked);
                }}
              />
              Billable
            </label>
          </div>
          <div style={{ marginTop: 6 }}>
            <TagPicker tags={tags} selected={selectedTags} onChange={setSelectedTags} />
          </div>
        </div>

        <div className="timer-start">
          <div className="timer-display idle" aria-hidden="true">
            00:00:00
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            icon={<Play size={15} aria-hidden="true" fill="currentColor" />}
            disabled={starting}
          >
            {starting ? "Starting…" : "Start"}
          </Button>
          <span className="start-status">
            {projects.length === 0
              ? "No projects yet — starting without one is fine."
              : "One timer per device"}
          </span>
        </div>
      </form>
    </section>
  );
}
