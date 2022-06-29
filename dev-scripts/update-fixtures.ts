import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { version as packageVersion } from '../package.json';

const oisPath = join(__dirname, '../test/fixtures/ois.json');
const ois = JSON.parse(readFileSync(oisPath, 'utf-8'));
ois.oisFormat = packageVersion;

writeFileSync(oisPath, JSON.stringify(ois, null, 2) + '\n');

console.log(`Updated ${oisPath}`);
