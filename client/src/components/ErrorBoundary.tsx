import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-screen flex-col items-center justify-center gap-4"
          style={{ background: 'var(--paper)', color: 'var(--ink)' }}
        >
          <p className="text-sm" style={{ color: 'var(--ink-faded)' }}>
            页面出了点问题
          </p>
          <button
            onClick={() => window.location.reload()}
            className="h-9 rounded-lg px-4 text-sm font-medium"
            style={{
              background: 'var(--shelf)',
              border: '0.5px solid var(--separator)',
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
