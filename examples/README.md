# Integração server-side

`server/handlers.ts` contém POST curto e GET curto, compatíveis com Request e
Response. Não usa polling bloqueante, não aceita loja arbitrária do navegador e
exige políticas fornecidas pela aplicação. O SDK não cria usuários nem autentica
visitantes em nome do site.

## Next.js App Router

Após copiar o factory para o projeto, crie um módulo `lib/zinix-server.ts`:

```ts
import 'server-only';
import { Zinix } from '@zinix/sdk';
import { createHandlers } from './zinix-handlers';
import { policies } from './simulation-policies'; // Implementação REAL do seu app.

export const handlers = createHandlers(
  new Zinix({ apiKey: process.env.ZINIX_API_KEY! }), policies,
);
```

Em `app/api/financiamento/route.ts`:

```ts
import { handlers } from '@/lib/zinix-server';
export const runtime = 'nodejs';
export const POST = handlers.POST;
```

Em `app/api/financiamento/[id]/route.ts`:

```ts
import { handlers } from '@/lib/zinix-server';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handlers.GET(request, (await context.params).id);
}
```

Implemente as cinco políticas do factory: autenticação/autorização, rate limit
compartilhado, validação do formulário, gravação durável de propriedade e consulta
de propriedade. `idempotencyScope` deve ser um identificador opaco e estável por
usuário/sessão autorizada, sem CPF/e-mail. Guarde também a chave de operação e o UUID
em seu fluxo durável para recuperação após timeout. Não use mapas em memória em
produção/serverless; não confie em `subject` enviado no body.

`authorize` também deve verificar CSRF/origem em autenticação por cookies. Para
visitante público, configure sessão assinada + proteção antiabuso/captcha e limites
por IP/sessão antes do POST. Um formulário público sem essas proteções pode consumir
os créditos da loja. Limite o body (por exemplo, 32 KiB) na camada HTTP e não registre
CPF, telefone, e-mail, body ou headers de autorização em logs.

## React + Vite

Sites estáticos não executam Route Handlers. Use as mesmas operações no backend
Node/VPS/serverless que atenderá o site, mantendo a chave apenas nele.
Depois configure o navegador para chamar `/api/financiamento` desse backend, com
a sessão e as proteções acima. Os GETs usam a mesma sessão e UUID e ocorrem no
intervalo de 20 segundos até estado final, no máximo três minutos.

Não importe o cliente SDK no bundle Vite. Importações **somente de tipos**
com `import type` são possíveis, mas não substituem o backend.

A integração depende do backend de hospedagem e da política de sessão/antiabuso
de cada aplicação; o SDK não contém configuração específica de nenhuma loja.
