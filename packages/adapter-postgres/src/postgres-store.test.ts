import {
  canonicalStoreComplianceTests,
  decisionLifecycleStoreComplianceTests,
} from '@kotowari/plugin-sdk';

import { createPgliteCanonicalStore } from './postgres-store.js';

const factory = () => createPgliteCanonicalStore();

canonicalStoreComplianceTests(factory);
decisionLifecycleStoreComplianceTests(factory);
