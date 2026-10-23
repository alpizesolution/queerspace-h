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
        <div className="min-h-screen flex items-center justify-center p-4 bg-[#17121B] text-[#F7F0F6]">
          <div className="max-w-md w-full bg-[#241B29] rounded-3xl border border-[#403247] p-8 text-center shadow-xl">
            <div className="w-12 h-12 rounded-2xl bg-[#302235] text-[#C77DAA] border border-[#403247] flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-6 h-6" />
            </div>
            <h2 className="font-serif text-2xl font-bold text-[#F7F0F6] mb-2">
              Something gentle went off track
            </h2>
            <p className="text-sm text-[#BDB0BF] mb-6 leading-relaxed">
              We encountered an unexpected display glitch. Don't worry, your safe session preferences are preserved.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#C77DAA] hover:bg-[#b86b9a] text-[#17121B] text-xs sm:text-sm font-bold transition-all shadow-xs cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload QUEERSPACE</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
