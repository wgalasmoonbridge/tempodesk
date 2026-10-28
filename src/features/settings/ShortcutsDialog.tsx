import { Keyboard } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { useAppData } from "../../app/AppProvider";
import { formatShortcut } from "../../lib/time";

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, platform } = useAppData();
  const mod = platform?.platform === "macos" ? "⌘" : "Ctrl";

  const rows = [
    { label: "New manual entry", keys: `${mod}+N`, scope: "In app" },
    { label: "Focus search", keys: `${mod}+F`, scope: "In app" },
    { label: "Open settings", keys: `${mod}+,`, scope: "In app" },
    { label: "Close a dialog", keys: "Esc", scope: "In app" },
    {
      label: "Open / hide TempoDesk",
      keys: formatShortcut(settings.openShortcut),
      scope: "Global",
    },
    {
      label: "Start / stop timer",
      keys: formatShortcut(settings.toggleShortcut),
      scope: "Global",
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description="Global shortcuts work while another app is focused, if the OS allows them."
    >
      <div className="kbd-list">
        {rows.map((row) => (
          <div className="kbd-row" key={row.label}>
            <Keyboard size={14} aria-hidden="true" style={{ color: "var(--muted)" }} />
            <span>{row.label}</span>
            <span className="spacer" />
            <span className="badge">{row.scope}</span>
            <span className="kbd">{row.keys}</span>
          </div>
        ))}
      </div>
      {!settings.shortcutsEnabled ? (
        <p className="dialog-note" style={{ marginTop: 14 }}>
          Global shortcuts are currently disabled in Settings. In-app shortcuts still work.
        </p>
      ) : null}
    </Dialog>
  );
}
