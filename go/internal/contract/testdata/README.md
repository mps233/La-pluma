# Node oracle fixtures

These files are generated from the Node contract builders so the Go registry
cannot drift from the migration oracle.

Regenerate from the repository root with Node 22.12+:

```bash
cd server
node --experimental-strip-types --input-type=module - <<'JS'
import { buildAgentManifest, buildOpenApiSpec } from './routes/agentContract.ts';
import { writeFileSync } from 'node:fs';
const defaults = {
  adbPath: '/custom/platform-tools/adb',
  adbAddress: '127.0.0.1:7555',
  clientType: 'Bilibili',
};
writeFileSync(
  '../go/internal/contract/testdata/node-manifest-defaults.json',
  JSON.stringify(buildAgentManifest(defaults), null, 2) + '\n',
);
writeFileSync(
  '../go/internal/contract/testdata/node-openapi-defaults.json',
  JSON.stringify(buildOpenApiSpec(defaults), null, 2) + '\n',
);
JS
```

`go test ./internal/contract -run NodeOracle` compares both fixtures.
Parameter order is ignored because Go builds query parameters from a map.