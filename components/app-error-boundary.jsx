import { Component } from "react";

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[arc-wallet-app]", error);
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <main className="page-shell">
          <section
            className="wallet-login-screen"
            style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}
          >
            <div className="wallet-login-card" style={{ maxWidth: "560px", width: "100%" }}>
              <span className="wallet-login-eyebrow">Lumexa recovered safely</span>
              <h1>Wallet session is still connected</h1>
              <p>
                A wallet screen hit a display error. Your connection and keys were not affected.
              </p>
              <button type="button" className="primary-button" onClick={this.handleRetry}>
                Retry wallet screen
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => window.location.reload()}
              >
                Reload app
              </button>
              <small>Never reconnect just because a UI component failed.</small>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
