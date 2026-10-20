'use client';

import React from 'react';

export interface ErrorBoundaryProps {
  sectionName: string;
  onReset?: () => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(): void {
    // Intentionally omit console logging of caught exceptions so user input,
    // outputs, or secret parameters are never written to browser logs.
  }

  handleReset = (): void => {
    this.setState({ hasError: false });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid={`error-boundary-${this.props.sectionName}`}
          className="cl-badge-error flex flex-col gap-2 rounded-md p-4 text-xs"
        >
          <p className="font-semibold">
            [Error] {this.props.sectionName} encountered an unexpected rendering
            error.
          </p>
          <p>
            Your workspace input and pipeline settings are preserved. Reset this
            section to continue.
          </p>
          <div>
            <button
              type="button"
              onClick={this.handleReset}
              className="cl-btn-secondary rounded px-3 py-1 text-xs font-medium"
            >
              Reset {this.props.sectionName}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
