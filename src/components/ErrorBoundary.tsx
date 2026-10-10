import { Component, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Shows a page's crash instead of a black window, and writes it to the debug log. */
export class ErrorBoundary extends Component<{ children: ReactNode; name: string; onBack?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    invoke("debug_log_write", {
      name: `crash_${this.props.name}_${new Date().toISOString().replace(/[:.]/g, "-")}`,
      image: null,
      json: JSON.stringify({ page: this.props.name, message: error.message, stack: error.stack, componentStack: info.componentStack }, null, 1),
    }).catch(() => {});
  }

  componentDidUpdate(prev: { name: string }) {
    if (prev.name !== this.props.name && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ maxWidth: 820 }}>
        <h2>This page hit an error</h2>
        <div className="err">{this.state.error.message}</div>
        <pre className="small dim" style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>
          {this.state.error.stack}
        </pre>
        <div className="row">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          {this.props.onBack && (
            <button className="btn ghost" onClick={this.props.onBack}>
              Back to Sanctuary
            </button>
          )}
        </div>
        <div className="small dim" style={{ marginTop: 8 }}>The error was saved to the log folder.</div>
      </div>
    );
  }
}
