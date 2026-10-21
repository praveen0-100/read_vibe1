import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ReadVibe] UI error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const chunkError = /dynamically imported module|Loading chunk/i.test(this.state.error.message);
    return (
      <div className="page-shell">
        <div className="error-state big" role="alert">
          <AlertTriangle size={28} />
          <div>
            <strong>{chunkError ? 'A new version of ReadVibe is available' : 'This page hit a problem'}</strong>
            <p>{chunkError ? 'Reload to get the latest version.' : this.state.error.message}</p>
          </div>
          <button className="primary-button" onClick={() => (chunkError ? window.location.reload() : this.setState({ error: null }))}>
            <RotateCcw size={14} /> {chunkError ? 'Reload' : 'Try again'}
          </button>
        </div>
      </div>
    );
  }
}
