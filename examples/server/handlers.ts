import { Zinix, ZinixApiError, ZinixValidationError, type SimulationRequest } from '@zinix/sdk';

/** Application-owned policies are REQUIRED, not permissive stubs. */
export interface Policies {
  authorize(request: Request): Promise<{ subject: string; legalEntityId: string; idempotencyScope: string } | null>;
  allowRequest(subject: string, operation: 'create' | 'read'): Promise<boolean>;
  validateInput(input: unknown): SimulationRequest;
  saveOwnership(subject: string, simulationId: string): Promise<void>;
  ownsSimulation(subject: string, simulationId: string): Promise<boolean>;
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/** Standard Request/Response handlers usable by Next.js or a Node HTTP adapter. */
export function createHandlers(zinix: Zinix, policies: Policies) {
  async function handleError(error: unknown): Promise<Response> {
    if (error instanceof ZinixApiError) return json({ error: { code: error.code, message: error.message }, request_id: error.requestId }, error.status);
    if (error instanceof ZinixValidationError || error instanceof SyntaxError) return json({ error: 'Dados inválidos.' }, 400);
    return json({ error: 'Não foi possível concluir a operação. Preserve a chave de idempotência e tente consultar o resultado.' }, 502);
  }
  return {
    async POST(request: Request): Promise<Response> {
      try {
        const auth = await policies.authorize(request);
        if (!auth) return json({ error: 'Não autorizado.' }, 401);
        if (!(await policies.allowRequest(auth.subject, 'create'))) return json({ error: 'Limite de requisições.' }, 429);
        const key = request.headers.get('Idempotency-Key') ?? '';
        if (!/^[A-Za-z0-9._:-]{8,64}$/.test(key) || !/^[A-Za-z0-9_-]{8,48}$/.test(auth.idempotencyScope)) return json({ error: 'Chave de operação inválida.' }, 400);
        // Enforce request body size in your server/proxy before this handler.
        const payload = policies.validateInput(await request.json());
        // Entity belongs to the authenticated session/store config, never the visitor.
        const result = await zinix.simulations.create({ ...payload, legal_entity_id: auth.legalEntityId }, {
          idempotencyKey: `${auth.idempotencyScope}.${key}`, signal: request.signal,
        });
        await policies.saveOwnership(auth.subject, result.data.id);
        return json({ id: result.data.id, status: result.data.status, retry_after_ms: result.data.retry_after_ms, request_id: result.data.request_id }, 202);
      } catch (error) { return handleError(error); }
    },
    async GET(request: Request, simulationId: string): Promise<Response> {
      try {
        const auth = await policies.authorize(request);
        if (!auth) return json({ error: 'Não autorizado.' }, 401);
        if (!(await policies.ownsSimulation(auth.subject, simulationId))) return json({ error: 'Simulação não encontrada.' }, 404);
        if (!(await policies.allowRequest(auth.subject, 'read'))) return json({ error: 'Limite de requisições.' }, 429);
        const result = await zinix.simulations.get(simulationId, { signal: request.signal });
        return json(result.data);
      } catch (error) { return handleError(error); }
    },
  };
}
