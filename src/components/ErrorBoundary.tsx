import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled QUEERSPACE UI error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-ink text-fg">
          <div className="max-w-sm w-full text-center">
            <div className="w-14 h-14 rounded-full bg-raised border border-line text-berry flex items-center justify-center mx-auto mb-5">
              <Sparkles className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-semibold mb-2">Something went off track</h1>
            <p className="text-[15px] text-muted mb-6">Your preferences are safe. Reloading usually fixes it.</p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
              className="btn btn-primary w-full"
            >
              <RefreshCw className="w-4 h-4" />
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
