export interface IDegradableModule {
  isDegraded(): boolean;
  getDegradedReason(): string | null;
}
