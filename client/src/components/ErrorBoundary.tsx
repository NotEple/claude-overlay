import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Keeps an unexpected component error from leaving the dashboard as a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Overlay UI crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="loading-screen" role="alert">
        <div className="loading-screen__content">
          <div>
            <h1>Something went wrong</h1>
            <p>The page hit an unexpected error. Reloading normally restores the latest room state.</p>
          </div>
          <button className="ui-button ui-button--primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </main>
    );
  }
}
