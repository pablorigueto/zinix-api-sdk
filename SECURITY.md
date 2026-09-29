# Segurança

Não publique vulnerabilidades com credenciais ou dados pessoais em issues públicas.
Reporte-as pelo canal privado de suporte disponível em https://zinix.com.br/.

- SDK exclusivamente server-side. Guarde a chave em secret manager/variável de ambiente.
- Não use variáveis `NEXT_PUBLIC_` ou `VITE_` para credenciais.
- Não exponha proxies anônimos que consumam créditos: autentique ou estabeleça uma
  sessão verificada, implemente antiabuso e valide a propriedade de cada simulação.
- Use HTTPS. O SDK rejeita HTTP remoto e redirects, e não permite headers arbitrários.
- Transportes `fetch` customizados precisam respeitar `AbortSignal`, `redirect: error`
  e `cache: no-store`. São código confiável do backend, não uma opção do visitante.
- O SDK não armazena payloads nem emite logs. O aplicativo é responsável pela
  retenção, controle de acesso e tratamento adequado dos dados pessoais.
- Testes e exemplos não incluem tokens nem dados reais dos clientes Zinix.
