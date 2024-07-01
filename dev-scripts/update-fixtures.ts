import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { version as packageVersion } from '../package.json';

const oisPath = join(__dirname, '../test/fixtures/ois.json');
const ois = JSON.parse(readFileSync(oisPath, 'utf8'));
ois.oisFormat = packageVersion;

writeFileSync(oisPath, `${JSON.stringify(ois, null, 2)}\n`);

console.log(`Updated ${oisPath}`); // eslint-disable-line no-console
