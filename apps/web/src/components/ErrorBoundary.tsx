import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  fallback: ReactNode;
  onError?: (error: unknown) => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Contains failures of optional enhancements (e.g. the WebGL scene) so the page keeps working. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error);
    if (import.meta.env.DEV) console.warn('[s5y] section failed', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
