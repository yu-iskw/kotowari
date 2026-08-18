import {
  canonicalStoreComplianceTests,
  decisionLifecycleStoreComplianceTests,
} from '@kotowari/plugin-sdk';

import { createSqliteCanonicalStore } from './sqlite-store.js';

const factory = () => createSqliteCanonicalStore(':memory:');

canonicalStoreComplianceTests(factory);
decisionLifecycleStoreComplianceTests(factory);
