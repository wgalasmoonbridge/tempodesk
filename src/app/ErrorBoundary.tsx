import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "../components/Button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No task descriptions or user content are logged, only the component stack.
    console.error("TempoDesk UI error", error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
          <div className="card card-pad" style={{ maxWidth: 560 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <AlertTriangle size={22} aria-hidden="true" style={{ color: "var(--danger)", flex: "none" }} />
              <div>
                <h1 style={{ fontSize: 18 }}>TempoDesk hit an unexpected interface error</h1>
                <p style={{ color: "var(--muted)", fontSize: 13 }}>
                  Your saved time is safe in the local database. Reload the window to continue.
                  If this repeats, create a backup from Settings after reloading.
                </p>
                <p className="mono" style={{ color: "var(--muted)" }}>
                  {this.state.error.message}
                </p>
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Reload interface
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
