import { canonicalStoreComplianceTests } from '@kotowari/plugin-sdk';

import { createSqliteCanonicalStore } from './sqlite-store.js';

canonicalStoreComplianceTests(() => createSqliteCanonicalStore(':memory:'));
