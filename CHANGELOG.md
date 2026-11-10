# Changelog

## 0.2.0

- `simulations.get(id, { include: 'financial_details' })` and
  `simulations.wait(id, { include: 'financial_details' })` request optional annual
  interest, monthly/annual CET, bank return reference/percentage and insurance
  inclusion indicators.
- Export `FinancialDetails` and `SimulationGetOptions` types. Unknown values are
  nullable; zero and false are preserved. Existing calls keep the default API
  representation. The SDK does not estimate CET or interpret return identifiers
  as percentages.
- Server example forwards the optional include only after authentication and
  ownership checks. Existing multi-CNPJ selection remains unchanged.
- 35 tests pass, including default requests, opt-in polling, invalid includes,
  multi-CNPJ authorization and safe server handlers.

Use API contract 1.1.0 at https://zinix.com.br/api/swagger/. No changes to creation,
idempotency, polling limits, credit billing or bank approval semantics.
