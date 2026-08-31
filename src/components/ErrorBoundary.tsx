import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  moduleName?: string;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`ErrorBoundary caught an error in [${this.props.moduleName || 'App'}]:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="max-w-md mx-auto p-4 animate-fade-in">
          <div className="bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 shadow-xl border border-rose-200 dark:border-rose-900/40 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-500 mx-auto flex items-center justify-center border border-rose-100 dark:border-rose-900/30">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Тимчасова помилка {this.props.moduleName ? `(«${this.props.moduleName}»)` : ''}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                Додаток захистив дані від збою. Ви можете спробувати оновити розділ або перезавантажити додаток.
              </p>
              {this.state.error?.message && (
                <div className="mt-2.5 p-2.5 bg-gray-50 dark:bg-zinc-800 rounded-xl text-[11px] font-mono text-gray-600 dark:text-gray-300 break-all">
                  {this.state.error.message}
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex-1 py-2.5 px-3 rounded-xl bg-rose-500 hover:bg-rose-600 active:scale-95 text-white font-bold text-xs shadow-md shadow-rose-500/20 transition flex items-center justify-center space-x-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Спробувати знову</span>
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="py-2.5 px-3 rounded-xl bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 active:scale-95 text-gray-700 dark:text-gray-200 font-semibold text-xs transition flex items-center justify-center space-x-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Перезавантажити</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
