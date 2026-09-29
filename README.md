# Zinix SDK — TypeScript

Cliente server-side para a API pública de simulações da Zinix. TypeScript e
JavaScript ESM, Node.js 22+, sem dependências de runtime.

Inclui catálogo, lojas/CNPJs, bancos, criação e consulta de simulações, polling,
saldo e consumo. Funciona no backend do Next.js ou em um backend Node separado
para aplicações React/Vite. **Não importe o cliente em componentes de navegador.**

SDK open source sob MIT. O acesso ao serviço Zinix continua dependendo de
credencial e plano contratado; a licença não torna a API gratuita ou pública.

## Instalação pelo código-fonte

Repositório: [pablorigueto/zinix-api-sdk](https://github.com/pablorigueto/zinix-api-sdk).
O nome do pacote é `@zinix/sdk`; esta versão ainda não foi publicada no npm.

```sh
git clone https://github.com/pablorigueto/zinix-api-sdk.git
cd zinix-api-sdk
npm ci
npm test
npm pack

# No backend consumidor, usando o arquivo gerado:
npm install ../zinix-api-sdk/zinix-sdk-0.1.0.tgz
```

## Cliente

```ts
import { Zinix } from '@zinix/sdk';

const zinix = new Zinix({ apiKey: process.env.ZINIX_API_KEY! });
const { data: lojas } = await zinix.legalEntities.list();
const { data: saldo } = await zinix.billing.get();
```

O endereço padrão é `https://saas.zinix.com.br/v1`. Não há chave de homologação.
`baseUrl` pode apontar para um servidor local de testes, usando HTTP apenas em
loopback. Não há fallback para credenciais, Store ID ou dados de clientes.

Cada método retorna `{ data, meta }`. Listas e consultas que a API envolve em
`{ data }` são desembrulhadas uma vez. `meta` contém status HTTP, `requestId`,
`retryAfterMs`, ETag e limites de requisições, quando enviados pela API.

## Métodos

| Método | Operação |
| --- | --- |
| `legalEntities.list()` | CNPJs ativos da credencial |
| `legalEntities.banks(legalEntityId)` | Bancos habilitados da loja |
| `vehicles.brands({ legal_entity_id, type })` | Marcas |
| `vehicles.models({ legal_entity_id, type, brand_code })` | Modelos |
| `vehicles.versions({ legal_entity_id, type, brand_code, model_code, manufacture_year, model_year })` | Versões |
| `simulations.create(payload, { idempotencyKey })` | Uma submissão assíncrona |
| `simulations.get(uuid)` | Estado e resultado persistidos |
| `simulations.wait(uuid, options?)` | Polling GET a cada 20 segundos |
| `usage.get({ from?, to? })` | Consumo e CPFs únicos |
| `billing.get()` | Cota, extras e saldo atual |

`type` é `car` ou `motorcycle`. Datas usam `YYYY-MM-DD`. Valores monetários usam
centavos inteiros. Use códigos e nomes retornados pelo catálogo, não invente IDs.
Todos os métodos HTTP aceitam `{ signal, timeoutMs }` como último argumento.

## Criar, persistir o UUID e acompanhar

```ts
import { randomUUID } from 'node:crypto';
import { Zinix, ZinixPollTimeoutError, type SimulationRequest } from '@zinix/sdk';

const zinix = new Zinix({ apiKey: process.env.ZINIX_API_KEY! });

// Monte com dados autorizados do formulário e códigos reais do catálogo.
async function simular(payload: SimulationRequest) {
  const idempotencyKey = randomUUID();
  // Grave a chave junto à operação em seu banco ANTES da chamada.
  const { data: aceita } = await zinix.simulations.create(payload, { idempotencyKey });
  // Grave aceita.id e aceita.request_id ANTES de iniciar o acompanhamento.
  try {
    return await zinix.simulations.wait(aceita.id);
  } catch (error) {
    if (error instanceof ZinixPollTimeoutError) {
      // Retome depois com simulations.get(error.simulationId).
      // O timeout local não cancela a operação bancária nem implica recusa.
      return { id: error.simulationId, pending: true };
    }
    throw error;
  }
}
```

O payload completo está em [examples/payload.ts](examples/payload.ts), com dados
**fictícios/inválidos para produção**, e é tipado por `SimulationRequest`.
O backend da API é a autoridade para validações de CPF, idade, veículo e plano.

### Idempotência e falhas de rede

O SDK exige a chave de idempotência; não gera uma nova silenciosamente e não
repete POSTs. Em timeout ou perda da resposta, o servidor pode já ter aceitado a
operação. Para recuperá-la, envie **o mesmo payload e a mesma chave**. Nunca gere
outra chave para tentar resolver uma falha de acompanhamento. Chave reutilizada
com outro payload gera HTTP 409. Replay pode retornar status já concluído.

### Polling e consulta posterior

`wait()` espera 20 segundos antes do primeiro GET, respeita o maior intervalo
entre 20s, `Retry-After` e `retry_after_ms`, e encerra em até 3 minutos por padrão.
Aceita `timeoutMs` menor, `intervalMs` maior, `signal` e `onUpdate`.
Somente GET com HTTP 429 é repetido automaticamente dentro dessa janela; outros
erros são entregues ao chamador. O SDK não segue `status_url` externo nem redirects.

`completed`, `partial`, `failed` e `expired` encerram o polling e são devolvidos
normalmente: resultado bancário não é exceção HTTP. Uma consulta posterior com
`get(uuid)` lê o mesmo resultado enquanto disponível, sem criar nova simulação.

**Em sites/serverless, não mantenha uma requisição do visitante aberta por três
minutos:** faça um POST curto, persista a associação usuário→UUID e use GETs curtos
no backend. `wait()` é indicado para jobs/processos que suportem essa duração.

### Interpretar ofertas

`status: completed` na simulação significa processamento encerrado, **não**
aprovação de todos os bancos. Leia `results[].status`, `conditions`, `issues`
e `error`. Bancos podem ter ofertas para alguns prazos e falhas para outros.

- Preserve `condition_id` e `down_payment_cents` de cada oferta.
- Nunca agrupe apenas por número de parcelas: uma oferta pode exigir outra entrada.
- `monthly_rate_estimated` indica taxa calculada, não informada pelo banco.
- Não invente parcelas nem anuncie aprovação quando `conditions` estiver vazio.
- `partial` pode conter ofertas válidas; mostre também as pendências/falhas.

### Créditos

Use `billing_charge` da criação para identificar o débito daquela operação e
`billing.get()` para o saldo atual. Não some recargas novamente ao saldo retornado.
A regra é CPF único por competência, não uma cobrança por GET/polling. HTTP 402
deve ser tratado mesmo depois de uma consulta de saldo positiva, pois há concorrência.

## Erros

```ts
import { ZinixApiError } from '@zinix/sdk';

try {
  await zinix.billing.get();
} catch (error) {
  if (error instanceof ZinixApiError) {
    // Mensagem e referência para suporte; nunca registre chave ou payload pessoal.
    console.error(error.status, error.code, error.message, error.requestId);
  } else {
    throw error;
  }
}
```

Também são exportados `ZinixValidationError`, `ZinixNetworkError`,
`ZinixTimeoutError`, `ZinixAbortError`, `ZinixProtocolError` e
`ZinixPollTimeoutError`. O SDK não registra logs e não inclui respostas HTML,
headers de autorização ou causas de transporte nos erros.

## Next.js e React/Vite

Veja [examples/README.md](examples/README.md). O SDK é independente do framework;
aplicações estáticas React/Vite precisam de um backend para guardar a credencial.

- Next.js: use o SDK em Route Handlers ou serviços exclusivamente server-side.
- React/Vite: o navegador chama seu backend, e esse backend utiliza o SDK.
- Nunca use `NEXT_PUBLIC_ZINIX_API_KEY` ou `VITE_ZINIX_API_KEY`.
- Antes de publicar um formulário público: validação, antiabuso, limites, consentimento
  e autorização por operação. O UUID sozinho não comprova que o visitante é dono dela.

## Desenvolvimento e publicação

```sh
npm ci
npm run check
npm test
npm pack --dry-run
```

Testes são offline, com provedor HTTP simulado, sem leads reais ou débitos. CI
preparada para Node 22 e 24. O pacote contém `dist`, `src` (para depuração), README e licença.
Não inclua banco de dados, `.env`, tokens, cadastros ou código privado do SaaS.
O contrato público foi conferido com o Swagger e o controlador `/v1` existentes.
As particularidades do backend (replay terminal, campos opcionais) estão tipadas.

Contribuições podem ser enviadas por pull request neste repositório.
O escopo npm `@zinix` precisa estar sob seu controle antes de `npm publish`.

Referências: [API Zinix](https://zinix.com.br/api/),
[fetch no Node.js](https://nodejs.org/api/globals.html#fetch),
[Route Handlers Next.js](https://nextjs.org/docs/app/getting-started/route-handlers).
