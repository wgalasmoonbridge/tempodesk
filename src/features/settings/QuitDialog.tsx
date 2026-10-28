import { useState } from "react";
import { LogOut, Save, Square } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import { formatDuration } from "../../lib/time";
import { useNow } from "../../lib/hooks";

export function QuitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status } = useAppData();
  const { pushToast } = useToast();
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);
  const active = status?.activeEntry ?? null;

  const quit = async (stopTimer: boolean) => {
    setBusy(true);
    try {
      await api.quitApp(stopTimer);
    } catch (error) {
      setBusy(false);
      pushToast({
        title: "Could not quit",
        message: normalizeError(error).message,
        tone: "error",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Quit TempoDesk?"
      description={
        active
          ? "A timer is still running. Choose what happens to it before quitting."
          : "TempoDesk will close. Your local data stays on this device."
      }
      dismissible={!busy}
      footer={
        <>
          <span className="spacer" />
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {active ? (
            <>
              <Button
                onClick={() => void quit(false)}
                disabled={busy}
                icon={<Save size={13} aria-hidden="true" />}
              >
                Keep running & quit
              </Button>
              <Button
                variant="primary"
                onClick={() => void quit(true)}
                disabled={busy}
                icon={<Square size={12} aria-hidden="true" />}
                data-autofocus
              >
                Stop timer & quit
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={() => void quit(false)}
              disabled={busy}
              icon={<LogOut size={14} aria-hidden="true" />}
              data-autofocus
            >
              Quit TempoDesk
            </Button>
          )}
        </>
      }
    >
      {active ? (
        <div className="dialog-note" style={{ marginTop: 0 }}>
          <Square size={14} aria-hidden="true" />
          <span>
            <strong>Stop timer & quit</strong> saves the elapsed time now.{" "}
            <strong>Keep running & quit</strong> preserves the session; on next launch TempoDesk
            asks whether to continue or finish it at the last known time. Nothing is discarded
            automatically.
          </span>
        </div>
      ) : null}
      {active ? (
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 0 }}>
          Running: {active.description.trim() || "Untitled session"} ·{" "}
          {formatDuration(
            Math.max(0, Math.floor((now - active.startAtUtc) / 1000)),
            "compact",
          )}
        </p>
      ) : null}
    </Dialog>
  );
}
