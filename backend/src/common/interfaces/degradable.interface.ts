export interface ModuleResult<T = void> {
  success: boolean;
  data?:   T;
  error?: {
    code:    string;
    message: string;
  };
}

export interface IDegradableModule {
  isDegraded():        boolean;
  getDegradedReason(): string | null;
}
