import { canonicalStoreComplianceTests } from '@kotowari/plugin-sdk';

import { createPgliteCanonicalStore } from './postgres-store.js';

canonicalStoreComplianceTests(() => createPgliteCanonicalStore());
