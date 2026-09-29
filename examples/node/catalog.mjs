// Read-only, optional real API example. Requires your server environment credentials.
// node --env-file=.env examples/node/catalog.mjs
import { Zinix } from '../../dist/index.js';
const zinix = new Zinix({ apiKey: process.env.ZINIX_API_KEY });
const { data: stores } = await zinix.legalEntities.list();
// Only masked CNPJs and public entity IDs; never print tokens or applicant data.
console.log(stores.map(({ id, trade_name, cnpj_masked }) => ({ id, trade_name, cnpj_masked })));
