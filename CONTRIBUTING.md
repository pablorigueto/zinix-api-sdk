# Contribuindo

Use Node.js 22+ e execute `npm ci`, `npm run check` e `npm test`.

Alterações em endpoints devem acompanhar o contrato público `/v1`, com testes
de request/response. Não copie código privado do backend ou cadastros para este
repositório. Use fixtures sintéticas e transporte HTTP simulado.

Não adicione retries automáticos de POST, chaves no navegador, atalhos para outros
tenants ou redução do intervalo mínimo de polling. Mantenha ofertas separadas por
condição/entrada, e a distinção entre processamento encerrado e aprovação bancária.

Antes de publicar: revise `npm pack --dry-run`, confirme licença, nome/escopo npm
e configure URL do repositório no package.json. Releases devem usar versão semântica.
