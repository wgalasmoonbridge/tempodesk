import { useEffect, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { TagPicker } from "../../components/TagPicker";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import type { CreatedEntry, TimeEntry } from "../../lib/types";
import {
  effectiveTimeZone,
  formatDuration,
  todayKey,
  zonedDateKey,
  zonedTimeSecondsValue,
  zonedTimeValue,
} from "../../lib/time";
import { validateManualForm } from "../../lib/validators";
import type { ManualFormValues } from "../../lib/validators";

interface EntryDialogProps {
  open: boolean;
  onClose: () => void;
  entry?: TimeEntry | null;
  defaultDate?: string;
  defaultProjectId?: string | null;
  defaultDescription?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  defaultNextDay?: boolean;
  onSaved?: (created: CreatedEntry) => void;
}

function timeFromParts(ms: number, tz: string): string {
  return zonedTimeSecondsValue(ms, tz);
}

export function EntryDialog({
  open,
  onClose,
  entry,
  defaultDate,
  defaultProjectId,
  defaultDescription,
  defaultStartTime,
  defaultEndTime,
  defaultNextDay,
  onSaved,
}: EntryDialogProps) {
  const { projects, tags, settings } = useAppData();
  const { pushToast } = useToast();
  const timezone = effectiveTimeZone(settings.timezone);
  const running = Boolean(entry?.running);

  const [date, setDate] = useState(todayKey(timezone));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [nextDay, setNextDay] = useState(false);
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [billable, setBillable] = useState(false);
  const [billableTouched, setBillableTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAttempted(false);
    setServerError(null);
    setBillableTouched(false);
    const now = Date.now();
    if (entry) {
      const startDate = zonedDateKey(entry.startAtUtc, timezone);
      const endDate = entry.endAtUtc
        ? zonedDateKey(entry.endAtUtc, timezone)
        : startDate;
      setDate(startDate);
      setStartTime(timeFromParts(entry.startAtUtc, timezone));
      setEndTime(
        entry.endAtUtc
          ? timeFromParts(entry.endAtUtc, timezone)
          : timeFromParts(now, timezone),
      );
      setNextDay(startDate !== endDate);
      setDescription(entry.description);
      setProjectId(entry.projectId ?? "");
      setTagIds(entry.tags.map((tag) => tag.id));
      setBillable(entry.isBillable);
      setBillableTouched(true);
    } else {
      const end = now - (now % 60_000);
      const start = end - 60 * 60_000;
      const startDateKey = zonedDateKey(start, timezone);
      const endDateKey = zonedDateKey(end, timezone);
      // Around midnight, one hour ago can be yesterday; default the form to that date so the
      // computed start is never in the future.
      setDate(defaultDate ?? startDateKey);
      setStartTime(defaultStartTime ?? zonedTimeValue(start, timezone));
      setEndTime(defaultEndTime ?? zonedTimeValue(end, timezone));
      setNextDay(defaultNextDay ?? (startDateKey !== endDateKey));
      setDescription(defaultDescription ?? "");
      setProjectId(defaultProjectId ?? "");
      setTagIds([]);
      const project = projects.find((item) => item.id === (defaultProjectId ?? ""));
      setBillable(project?.defaultBillable ?? false);
    }
    // Only reset when the dialog opens or the edited entry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    entry?.id,
    defaultDate,
    defaultProjectId,
    defaultDescription,
    defaultStartTime,
    defaultEndTime,
    defaultNextDay,
    timezone,
  ]);

  const formValues: ManualFormValues = {
    date,
    startTime,
    endTime,
    nextDay,
    description,
  };
  const validation = validateManualForm(formValues, timezone);

  const durationPreview =
    running && entry
      ? Math.max(0, Math.floor((Date.now() - entry.startAtUtc) / 1000))
      : validation.durationSeconds;

  const onProjectChange = (value: string) => {
    setProjectId(value);
    if (!billableTouched) {
      const project = projects.find((item) => item.id === value);
      setBillable(project?.defaultBillable ?? false);
    }
  };

  const save = async () => {
    setAttempted(true);
    setServerError(null);
    if (!running && !validation.ok) return;
    if (entry?.running) {
      if (!validation.startAtUtc || validation.startAtUtc > Date.now() + 1000) {
        setServerError("Enter a valid start time that is not in the future.");
        return;
      }
    }
    setSaving(true);
    try {
      let created: CreatedEntry;
      if (entry) {
        const endAtUtc = entry.running
          ? null
          : validation.endAtUtc ?? entry.endAtUtc;
        if (!entry.running && endAtUtc === null) {
          setServerError("A completed entry needs an end time.");
          setSaving(false);
          return;
        }
        created = await api.updateEntry(entry.id, {
          description: description.trim(),
          projectId: projectId || null,
          tagIds,
          isBillable: billable,
          startAtUtc: validation.startAtUtc ?? entry.startAtUtc,
          endAtUtc,
        });
      } else {
        if (!validation.input) {
          setSaving(false);
          return;
        }
        created = await api.createManualEntry({
          ...validation.input,
          projectId: projectId || null,
          tagIds,
          isBillable: billable,
        });
      }

      if (created.overlaps.length > 0) {
        pushToast({
          title: `Saved with ${created.overlaps.length} overlapping ${
            created.overlaps.length === 1 ? "entry" : "entries"
          }`,
          message:
            "Overlaps are allowed, but the overlapping time is counted in each entry. Review if this was unintentional.",
          tone: "warning",
          duration: 9000,
        });
      } else {
        pushToast({
          title: entry ? "Entry updated" : "Entry added",
          message: `${formatDuration(durationPreview, "compact")} recorded.`,
          tone: "success",
        });
      }
      onSaved?.(created);
      onClose();
    } catch (error) {
      const normalized = normalizeError(error);
      setServerError(normalized.message);
    } finally {
      setSaving(false);
    }
  };

  const overnightHint =
    attempted && !running && !validation.ok && validation.needsNextDay;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry ? "Edit time entry" : "Add manual entry"}
      description={
        entry
          ? "Adjust the description, classification, or times for this session."
          : "Record work you forgot to track. Times use your local time zone."
      }
      wide
      dismissible={!saving}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : entry ? "Save changes" : "Add entry"}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="span-2">
          <Field label="Description (optional)">
            {(props) => (
              <input
                {...props}
                className="input"
                data-autofocus
                value={description}
                maxLength={1000}
                placeholder="What did you work on?"
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Project">
          {(props) => (
            <select
              {...props}
              className="select"
              value={projectId}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.clientName ? ` — ${project.clientName}` : ""}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="field">
          <span className="field-label">Billable</span>
          <label className="check" style={{ height: 34 }}>
            <input
              type="checkbox"
              checked={billable}
              onChange={(event) => {
                setBillableTouched(true);
                setBillable(event.target.checked);
              }}
            />
            Bill this time
          </label>
        </div>

        <div className="span-2 field">
          <span className="field-label">Tags</span>
          <TagPicker
            tags={tags}
            selected={tagIds}
            onChange={setTagIds}
            disabled={saving}
          />
        </div>

        <Field label="Date">
          {(props) => (
            <input
              {...props}
              type="date"
              className="input"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </Field>

        <div className="field">
          <span className="field-label">Duration</span>
          <div
            className="input"
            style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--surface-muted)" }}
            aria-live="polite"
          >
            <Clock size={14} aria-hidden="true" />
            <span className="mono" style={{ fontSize: 13 }}>
              {formatDuration(durationPreview, "hms")}
            </span>
            <span style={{ color: "var(--muted)", fontSize: 11 }}>
              ({formatDuration(durationPreview, "compact")})
            </span>
          </div>
        </div>

        <Field label="Start time">
          {(props) => (
            <input
              {...props}
              type="time"
              step="1"
              className="input"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="End time"
          hint={running ? "The end time is recorded when you stop this timer." : undefined}
        >
          {(props) => (
            <input
              {...props}
              type="time"
              step="1"
              className="input"
              value={endTime}
              disabled={running}
              onChange={(event) => setEndTime(event.target.value)}
            />
          )}
        </Field>

        {!running ? (
          <label className="check" style={{ gridColumn: "span 2" }}>
            <input
              type="checkbox"
              checked={nextDay}
              onChange={(event) => setNextDay(event.target.checked)}
            />
            Ends next day (overnight session)
          </label>
        ) : null}
      </div>

      {overnightHint ? (
        <div className="dialog-note">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            The end time is earlier than the start time. Tick{" "}
            <strong>Ends next day</strong> above to record an overnight session, or adjust the
            times.
          </span>
        </div>
      ) : null}

      {attempted && !validation.ok && !running && !overnightHint ? (
        <div className="dialog-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{validation.errors[0]}</span>
        </div>
      ) : null}

      {serverError ? (
        <div className="dialog-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{serverError}</span>
        </div>
      ) : null}
    </Dialog>
  );
}
