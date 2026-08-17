import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-950 p-6">
        <div className="panel max-w-lg p-6 text-center">
          <h1 className="text-xl font-semibold text-white">Project Intelligence Local failed to load</h1>
          <p className="mt-2 text-sm text-slate-400">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            className="btn-primary mt-5"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
