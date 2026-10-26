/** Wire types follow the public /v1 contract, not private Drupal/provider routes. */
export type VehicleType = 'car' | 'motorcycle';
export type SimulationStatus = 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'expired';
export type BankStatus = 'queued' | 'pending' | 'processing' | 'completed' | 'rejected' | 'unavailable' | 'failed' | 'timed_out';
export interface LegalEntity {
  id: string; legal_name: string; trade_name: string | null; cnpj_masked: string;
  is_primary: boolean; status: 'active' | 'inactive';
}
export interface Bank { code: string; name: string; status: string; enabled_for_simulation: boolean }
export interface CatalogItem { code: string; name: string }
export interface BrandQuery { legal_entity_id: string; type: VehicleType }
export interface ModelQuery extends BrandQuery { brand_code: string }
export interface VersionQuery extends ModelQuery { model_code: string; manufacture_year: number; model_year: number }
export interface Applicant {
  document: string; gender: 'male' | 'female'; name: string; birth_date: string;
  email: string; phone: string; state: string; city: string; has_driver_license: boolean;
}
export interface Vehicle {
  type: VehicleType; brand_code: string; brand_name: string; model_code: string; model_name: string;
  /** Exact code selected from vehicles.versions() / GET /v1/vehicles/versions; not model_code or stock ID. */
  version_code: string;
  /** name from the same selected catalog item as version_code. */
  version_name: string;
  manufacture_year: number; model_year: number; zero_km: boolean;
}
export interface Terms { asset_value_cents: number; down_payment_cents: number; installments: number[] }
export interface SimulationRequest { legal_entity_id: string; applicant: Applicant; vehicle: Vehicle; terms: Terms }
export interface Billing {
  mode: 'prepaid' | 'unlimited'; balance: number | null; can_submit: boolean; can_submit_new_cpf: boolean;
  current_period: string; monthly_quota: number | null; monthly_topup_credits: number;
  monthly_unique_cpfs_used: number; monthly_quota_remaining: number | null; carried_over_credits?: number;
  unit: 'unique_cpf_month'; timezone: string;
}
export interface BillingCharge {
  debited: boolean; units: 0 | 1; period: string; unit: 'unique_cpf_month';
  reason: 'new_cpf_this_month' | 'cpf_already_counted' | 'unlimited' | 'idempotent_replay' | 'not_debited';
  balance_after: number | null;
}
export interface SimulationAccepted {
  id: string;
  /** Idempotent replays can return a terminal status as well. */
  status: SimulationStatus;
  status_url: string; retry_after_ms: number; request_id: string; idempotent_replay: boolean;
  billing: Billing; billing_charge: BillingCharge;
}
export interface Condition {
  installments: number; installment_value_cents: number;
  /** Monthly interest in percent (% per month): 1.79 = 1.79% p.m.; divide by 100 for decimal calculations (0.0179). Not annual interest or CET. */
  monthly_rate: number;
  monthly_rate_estimated?: boolean; down_payment_cents?: number | null;
  financed_amount_cents?: number | null; condition_id?: string;
}
export interface BankIssue {
  code: string; message: string; status: 'rejected' | 'failed' | 'unavailable';
  installments: number; down_payment_cents: number | null;
}
export interface SimulationError {
  code: string; message: string; stage: string; provider_status: number | null; retryable: boolean;
  details: Array<{ field: string; code: string; message: string }>;
}
export interface BankResult { bank: string; status: BankStatus; conditions: Condition[]; issues?: BankIssue[]; error?: SimulationError }
export interface Simulation {
  id: string; legal_entity_id: string; status: SimulationStatus;
  progress: { expected_banks: number; finished_banks: number; pending_banks: number };
  results: BankResult[]; error?: SimulationError; status_url: string; retry_after_ms: number | null;
  created_at: string; updated_at: string; request_id: string;
}
export interface UsageQuery { from?: string; to?: string }
export interface UsageCounts { unique_cpfs: number; consultations: number; repeat_consultations: number }
export interface CpfUsage extends UsageCounts {
  period: { from: string; to: string; days: number; timezone: string };
  active_days: number; first_consultation?: number | null; last_consultation?: number | null;
  coverage: { from: string | null; to: string | null };
  by_day: Array<UsageCounts & { date: string }>;
  by_legal_entity: Array<UsageCounts & { legal_entity_id: string; name: string; cnpj_masked: string }>;
  by_source: Array<{ source: 'api' | 'portal'; unique_cpfs: number; consultations: number }>;
}
export interface Usage {
  period_days: number; requests: number; simulations: number; errors: number; last_request: number | null;
  monthly_quota: number; billing: Billing; cpf_usage: CpfUsage;
}
export interface ResponseMeta {
  status: number; requestId?: string; retryAfterMs?: number; etag?: string;
  rateLimit: { limit?: number; remaining?: number; reset?: number };
}
export interface ZinixResponse<T> { data: T; meta: ResponseMeta }
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface CreateOptions extends RequestOptions { idempotencyKey: string }
export interface PollOptions {
  signal?: AbortSignal;
  /** 1..180000 ms; the server's polling contract caps the window at three minutes. */
  timeoutMs?: number;
  /** At least 20000 ms. Retry-After can increase this. */
  intervalMs?: number;
  onUpdate?: (response: ZinixResponse<Simulation>) => void | Promise<void>;
}
export interface ZinixOptions {
  apiKey: string;
  /** Includes /v1. HTTPS required except for explicit loopback development. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Injection point for tests/server fetch implementations. Redirects must not be followed. */
  fetch?: typeof globalThis.fetch;
}
