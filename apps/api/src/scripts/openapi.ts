import fs from 'node:fs';
import { buildApp } from '../app';
process.env.JWT_SECRET ??= 'openapi-export-only-openapi-export-only';
const app = await buildApp();
await app.ready();
fs.writeFileSync(new URL('../../../../docs/openapi.json', import.meta.url), JSON.stringify(app.swagger(), null, 2));
await app.close();
console.log('docs/openapi.json written');
process.exit(0);
