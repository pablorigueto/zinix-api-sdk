import type { ResponseMeta, Simulation } from './types.js';

export class ZinixError extends Error {
  constructor(message: string) { super(message); this.name = new.target.name; }
}
export class ZinixValidationError extends ZinixError {}
export class ZinixNetworkError extends ZinixError {}
export class ZinixTimeoutError extends ZinixError {}
export class ZinixAbortError extends ZinixError {}
export class ZinixProtocolError extends ZinixError {}
export class ZinixApiError extends ZinixError {
  readonly status: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  readonly stage?: string;
  readonly providerStatus?: number | null;
  readonly retryable?: boolean;
  constructor(message: string, public readonly code: string, public readonly meta: ResponseMeta,
    public readonly details: unknown = undefined, provider?: { stage?: string; status?: number | null; retryable?: boolean }) {
    super(message); this.status = meta.status; this.requestId = meta.requestId; this.retryAfterMs = meta.retryAfterMs;
    this.stage = provider?.stage; this.providerStatus = provider?.status; this.retryable = provider?.retryable;
  }
}
export class ZinixPollTimeoutError extends ZinixTimeoutError {
  constructor(public readonly simulationId: string, public readonly lastSimulation?: Simulation) {
    super('Tempo de acompanhamento encerrado. Consulte o mesmo UUID depois; não crie outra simulação.');
  }
}
