import type { SimulationRequest } from '@zinix/sdk';

// Exemplo somente: CPF, telefone, UUID e códigos fictícios. NÃO enviar aos bancos.
export const payload = {
  legal_entity_id: '00000000-0000-4000-8000-000000000001',
  applicant: {
    document: '00000000000', gender: 'female', name: 'Pessoa Fictícia',
    birth_date: '1990-01-01', email: 'pessoa@example.invalid', phone: '00000000000',
    state: 'SP', city: 'Campinas', has_driver_license: true,
  },
  vehicle: {
    type: 'car', brand_code: 'CODIGO_MARCA', brand_name: 'MARCA DO CATALOGO',
    model_code: 'CODIGO_MODELO', model_name: 'MODELO DO CATALOGO',
    version_code: 'CODIGO_VERSAO', version_name: 'VERSAO DO CATALOGO',
    manufacture_year: 2024, model_year: 2025, zero_km: false,
  },
  terms: { asset_value_cents: 6500000, down_payment_cents: 1500000, installments: [24, 36, 48] },
} satisfies SimulationRequest;
