'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children:  ReactNode;
  fallback?: ReactNode;
  /** Optional label shown in the error UI (e.g. "Clientes") */
  section?:  string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.section ?? 'App', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    const { children, fallback, section } = this.props;

    if (!error) return children;

    if (fallback) return fallback;

    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center gap-4">
        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive text-xl font-bold">
          !
        </div>
        <div>
          <p className="font-semibold text-foreground">
            {section ? `Error en ${section}` : 'Error en la aplicación'}
          </p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            {error.message || 'Ocurrió un error inesperado.'}
          </p>
        </div>
        <button
          onClick={this.reset}
          className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-accent transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  }
}
