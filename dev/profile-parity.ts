import { collectParitySnapshot, semanticParityEqual } from '../apps/server/src/parity.ts';

async function main(): Promise<void> {
  const standaloneUrl = process.env['STANDALONE_URL'];
  const composeUrl = process.env['COMPOSE_URL'];
  const ingestPath = process.env['KOTOWARI_INGEST_PATH'] ?? 'testdata/vendor-x';
  if (standaloneUrl === undefined) {
    process.stderr.write('STANDALONE_URL is required\n');
    process.exitCode = 1;
    return;
  }
  const standalone = await collectParitySnapshot(standaloneUrl, { ingestPath });
  process.stdout.write(`${JSON.stringify({ standalone }, null, 2)}\n`);
  if (composeUrl === undefined) {
    const ok =
      standalone.healthOk &&
      standalone.claimCount > 0 &&
      standalone.evidenceLinked &&
      standalone.whySelectedPresent &&
      standalone.decisionHasSnapshot &&
      standalone.decisionHasPolicyIds &&
      standalone.evidenceHasBytes;
    process.exitCode = ok ? 0 : 1;
    return;
  }
  const compose = await collectParitySnapshot(composeUrl, {
    ingestPath,
    bearer: 'dev-local',
  });
  process.stdout.write(`${JSON.stringify({ compose }, null, 2)}\n`);
  process.exitCode = semanticParityEqual(standalone, compose) ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
