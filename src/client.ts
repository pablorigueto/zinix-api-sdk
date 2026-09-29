import type * as T from './types.js';
import { ZinixAbortError, ZinixApiError, ZinixNetworkError, ZinixPollTimeoutError,
  ZinixProtocolError, ZinixTimeoutError, ZinixValidationError } from './errors.js';

const POLL_MS = 20_000;
const MAX_POLL_MS = 180_000;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const statuses = new Set(['queued', 'processing', 'completed', 'partial', 'failed', 'expired']);
export function isTerminalStatus(status: T.SimulationStatus): boolean {
  return ['completed', 'partial', 'failed', 'expired'].includes(status);
}
function uuid(value: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ZinixValidationError('UUID inválido.');
  return value;
}
function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new ZinixValidationError(`${name} inválido.`);
  return value;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const delay = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ZinixAbortError('Acompanhamento cancelado.')); return; }
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); cleanup(); reject(new ZinixAbortError('Acompanhamento cancelado.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Server-side only. No automatic retries or hidden financial submissions. */
export class Zinix {
  #apiKey: string;
  #base: string;
  #fetch: typeof globalThis.fetch;
  #timeout: number;

  constructor(options: T.ZinixOptions) {
    if (typeof window !== 'undefined') throw new ZinixValidationError('Use o SDK no servidor. Nunca exponha a chave Zinix no navegador.');
    if (!options?.apiKey?.trim() || /\s/.test(options.apiKey)) throw new ZinixValidationError('Informe uma chave de API válida.');
    const url = new URL(options.baseUrl ?? 'https://saas.zinix.com.br/v1');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash) {
      throw new ZinixValidationError('baseUrl deve usar HTTPS, sem credenciais, query ou fragmento.');
    }
    this.#base = url.href.replace(/\/+$/, '');
    this.#apiKey = options.apiKey;
    this.#timeout = positive(options.timeoutMs ?? 30_000, 'timeoutMs');
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  readonly legalEntities = {
    list: (options?: T.RequestOptions) => this.#request<T.LegalEntity[]>('GET', '/legal-entities', options, undefined, undefined, true),
    banks: (id: string, options?: T.RequestOptions) => this.#request<T.Bank[]>('GET', `/legal-entities/${uuid(id)}/banks`, options, undefined, undefined, true),
  };
  readonly vehicles = {
    brands: (query: T.BrandQuery, options?: T.RequestOptions) => this.#catalog('/vehicles/brands', query, options),
    models: (query: T.ModelQuery, options?: T.RequestOptions) => this.#catalog('/vehicles/models', query, options),
    versions: (query: T.VersionQuery, options?: T.RequestOptions) => this.#catalog('/vehicles/versions', query, options),
  };
  readonly simulations = {
    create: (payload: T.SimulationRequest, options: T.CreateOptions): Promise<T.ZinixResponse<T.SimulationAccepted>> => {
      if (!options || !/^[A-Za-z0-9._:-]{8,128}$/.test(options.idempotencyKey)) throw new ZinixValidationError('idempotencyKey é obrigatória: 8–128 caracteres, letras, números, ponto, hífen, dois-pontos ou sublinhado.');
      uuid(payload.legal_entity_id);
      return this.#request('POST', '/simulations', options, payload, options.idempotencyKey);
    },
    get: (id: string, options?: T.RequestOptions) => this.#request<T.Simulation>('GET', `/simulations/${uuid(id)}`, options),
    wait: (id: string, options?: T.PollOptions) => this.#wait(uuid(id), options),
  };
  readonly usage = {
    get: (query: T.UsageQuery = {}, options?: T.RequestOptions) => {
      for (const date of [query.from, query.to]) {
        if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new ZinixValidationError('Datas devem usar YYYY-MM-DD e existir no calendário.');
      }
      if (query.from && query.to && query.from > query.to) throw new ZinixValidationError('from deve ser anterior ou igual a to.');
      return this.#request<T.Usage>('GET', this.#path('/usage', { from: query.from, to: query.to }), options, undefined, undefined, true);
    },
  };
  readonly billing = { get: (options?: T.RequestOptions) => this.#request<T.Billing>('GET', '/billing', options, undefined, undefined, true) };

  #catalog(path: string, query: T.BrandQuery | T.ModelQuery | T.VersionQuery, options?: T.RequestOptions) {
    uuid(query.legal_entity_id);
    if (!['car', 'motorcycle'].includes(query.type)) throw new ZinixValidationError('Tipo de veículo inválido.');
    // Deliberate allowlist: never propagate arbitrary browser query parameters.
    const params: Record<string, string | number | undefined> = { legal_entity_id: query.legal_entity_id, type: query.type };
    if (path !== '/vehicles/brands') {
      if (!('brand_code' in query) || !query.brand_code) throw new ZinixValidationError('brand_code obrigatório.');
      params.brand_code = query.brand_code;
    }
    if (path === '/vehicles/versions') {
      if (!('model_code' in query) || !query.model_code) throw new ZinixValidationError('model_code obrigatório.');
      params.model_code = query.model_code;
      params.manufacture_year = positive(query.manufacture_year, 'manufacture_year');
      params.model_year = positive(query.model_year, 'model_year');
    }
    return this.#request<T.CatalogItem[]>('GET', this.#path(path, params), options, undefined, undefined, true);
  }

  #path(path: string, query: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
    return params.size ? `${path}?${params}` : path;
  }

  async #request<R>(method: 'GET' | 'POST', path: string, options: T.RequestOptions = {}, body?: T.SimulationRequest, key?: string, unwrap = false): Promise<T.ZinixResponse<R>> {
    if (options.signal?.aborted) throw new ZinixAbortError('Requisição cancelada.');
    const timeout = positive(options.timeoutMs ?? this.#timeout, 'timeoutMs');
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${this.#apiKey}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (key) headers['Idempotency-Key'] = key;
      let response: Response;
      let text: string;
      try {
        response = await this.#fetch(`${this.#base}${path}`, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit',
        });
        text = await response.text();
      } catch {
        if (options.signal?.aborted) throw new ZinixAbortError('Requisição cancelada.');
        if (timedOut) throw new ZinixTimeoutError('Tempo de resposta excedido. Não crie outra operação; reutilize a mesma chave de idempotência.');
        // Do not attach fetch errors: custom transports can include headers/payloads.
        throw new ZinixNetworkError('Não foi possível acessar a API Zinix. A operação não foi reenviada.');
      }
      const number = (header: string): number | undefined => {
        const value = response.headers.get(header);
        return value !== null && /^\d+$/.test(value) ? Number(value) : undefined;
      };
      const meta: T.ResponseMeta = { status: response.status,
        requestId: response.headers.get('X-Request-Id') ?? undefined,
        retryAfterMs: retryAfter(response.headers.get('Retry-After')),
        etag: response.headers.get('ETag') ?? undefined,
        rateLimit: { limit: number('X-RateLimit-Limit'), remaining: number('X-RateLimit-Remaining'), reset: number('X-RateLimit-Reset') },
      };
      let decoded: unknown;
      try { decoded = JSON.parse(text.split(this.#apiKey).join('[REDACTED]')); } catch { /* no raw HTML/body in errors */ }
      if (record(decoded) && typeof decoded.request_id === 'string') meta.requestId ??= decoded.request_id;
      if (!response.ok) {
        const error = record(decoded) && record(decoded.error) ? decoded.error : {};
        throw new ZinixApiError(typeof error.message === 'string' ? error.message : `API Zinix respondeu HTTP ${response.status}.`,
          typeof error.code === 'string' ? error.code : 'http_error', meta, error.details, {
            stage: typeof error.stage === 'string' ? error.stage : undefined,
            status: typeof error.provider_status === 'number' || error.provider_status === null ? error.provider_status : undefined,
            retryable: typeof error.retryable === 'boolean' ? error.retryable : undefined,
          });
      }
      if (!record(decoded) || (unwrap && !('data' in decoded))) throw new ZinixProtocolError('Resposta JSON inesperada da API Zinix.');
      const data = unwrap ? decoded.data : decoded;
      if ((path.startsWith('/legal-entities') || path.startsWith('/vehicles/')) && !Array.isArray(data)) throw new ZinixProtocolError('Lista esperada na resposta da API Zinix.');
      if (path.startsWith('/simulations') && (!record(data) || typeof data.id !== 'string' || !UUID.test(data.id) || !statuses.has(String(data.status)))) throw new ZinixProtocolError('Resposta de simulação inválida.');
      return { data: data as R, meta };
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    }
  }

  async #wait(id: string, options: T.PollOptions = {}): Promise<T.ZinixResponse<T.Simulation>> {
    const timeout = positive(options.timeoutMs ?? MAX_POLL_MS, 'timeoutMs');
    const interval = positive(options.intervalMs ?? POLL_MS, 'intervalMs');
    if (timeout > MAX_POLL_MS || interval < POLL_MS) throw new ZinixValidationError('Polling: intervalo mínimo de 20 segundos e janela máxima de 3 minutos.');
    const deadline = Date.now() + timeout;
    let last: T.Simulation | undefined;
    let nextDelay = interval;
    while (true) {
      if (options.signal?.aborted) throw new ZinixAbortError('Acompanhamento cancelado. A simulação continua no servidor.');
      const remaining = deadline - Date.now();
      if (remaining <= nextDelay) {
        await delay(Math.max(0, remaining), options.signal);
        throw new ZinixPollTimeoutError(id, last);
      }
      await delay(nextDelay, options.signal);
      try {
        const response = await this.simulations.get(id, { signal: options.signal, timeoutMs: Math.max(1, Math.min(this.#timeout, deadline - Date.now())) });
        last = response.data;
        await options.onUpdate?.(response);
        if (isTerminalStatus(last.status)) return response;
        nextDelay = Math.max(interval, response.meta.retryAfterMs ?? 0, typeof last.retry_after_ms === 'number' && Number.isFinite(last.retry_after_ms) ? last.retry_after_ms : 0);
      } catch (error) {
        // Only a rate-limited GET is repeated, inside the original bounded window.
        if (error instanceof ZinixApiError && error.status === 429) nextDelay = Math.max(interval, error.retryAfterMs ?? 0);
        else if (error instanceof ZinixTimeoutError && Date.now() >= deadline) throw new ZinixPollTimeoutError(id, last);
        else throw error;
      }
    }
  }
}
