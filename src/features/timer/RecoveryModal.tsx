import { useState } from "react";
import { AlertTriangle, Play, Square } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import type { RecoveryAction } from "../../lib/types";
import {
  formatDateWithYear,
  formatDuration,
  formatTime,
  zonedDateKey,
} from "../../lib/time";

export function RecoveryModal() {
  const { status, timezone, settings, refreshAll } = useAppData();
  const { pushToast } = useToast();
  const [busy, setBusy] = useState<RecoveryAction | null>(null);

  const recovery = status?.pendingRecovery ?? null;
  if (!recovery) return null;

  const entry = recovery.entry;
  const startLabel = formatDateWithYear(zonedDateKey(entry.startAtUtc, timezone));

  const resolve = async (action: RecoveryAction) => {
    setBusy(action);
    try {
      await api.resolveRecovery(action);
      pushToast({
        title:
          action === "continue"
            ? "Timer resumed"
            : action === "stop_at_last_seen"
              ? "Timer stopped at last known time"
              : "Timer stopped",
        message:
          action === "continue"
            ? "The running session was preserved and continues from its original start."
            : "The session was saved. No recorded time was discarded.",
        tone: "success",
      });
      await refreshAll();
    } catch (error) {
      pushToast({
        title: "Could not resolve the recovered timer",
        message: normalizeError(error).message,
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={() => undefined}
      dismissible={false}
      title="Recover a timer from your last session"
      description="TempoDesk found a timer that was still running when the app last closed."
      footer={
        <>
          <span className="spacer" />
          <Button
            onClick={() => void resolve("stop_now")}
            disabled={busy !== null}
            icon={<Square size={13} aria-hidden="true" />}
          >
            Stop now
          </Button>
          <Button
            onClick={() => void resolve("stop_at_last_seen")}
            disabled={busy !== null || !recovery.canStopAtLastSeen}
            title={
              recovery.canStopAtLastSeen
                ? undefined
                : "No last-known timestamp was recorded for this session."
            }
          >
            Stop at last seen
          </Button>
          <Button
            variant="primary"
            onClick={() => void resolve("continue")}
            disabled={busy !== null}
            icon={<Play size={13} aria-hidden="true" />}
            data-autofocus
          >
            Continue timing
          </Button>
        </>
      }
    >
      <div className="dialog-note" style={{ marginTop: 0 }}>
        <AlertTriangle size={15} aria-hidden="true" />
        <span>
          {recovery.reason === "unclean_shutdown"
            ? "TempoDesk did not shut down normally. The timer below was still running."
            : "The previous session ended while this timer was running."}{" "}
          Choose what to do — nothing is discarded automatically.
        </span>
      </div>

      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "150px 1fr",
          gap: "8px 14px",
          margin: "16px 0 0",
          fontSize: 12.5,
        }}
      >
        <dt style={{ color: "var(--muted)" }}>Description</dt>
        <dd style={{ margin: 0 }}>{entry.description.trim() || "Untitled session"}</dd>
        <dt style={{ color: "var(--muted)" }}>Project</dt>
        <dd style={{ margin: 0 }}>{entry.projectName ?? "No project"}</dd>
        <dt style={{ color: "var(--muted)" }}>Started</dt>
        <dd style={{ margin: 0 }}>
          {startLabel} at {formatTime(entry.startAtUtc, timezone, settings.timeFormat)}
        </dd>
        <dt style={{ color: "var(--muted)" }}>Last recorded activity</dt>
        <dd style={{ margin: 0 }}>
          {formatTime(recovery.lastSeenAtUtc, timezone, settings.timeFormat)}
        </dd>
        <dt style={{ color: "var(--muted)" }}>Tracked before exit</dt>
        <dd style={{ margin: 0 }}>
          {formatDuration(recovery.estimatedSeconds, "hms")} (
          {formatDuration(recovery.estimatedSeconds, "compact")})
        </dd>
      </dl>
    </Dialog>
  );
}
