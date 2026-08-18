import { startComposeServer, startKotowariServer } from './public.js';

function listenPort(env: Record<string, string | undefined>): number {
  const raw = env['PORT'];
  if (raw === undefined || raw.length === 0) {
    return 8080;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 8080;
}

export async function startFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): Promise<{ url: string; close: () => Promise<void> }> {
  const profile = env['KOTOWARI_PROFILE'] ?? 'standalone';
  if (profile === 'compose' || profile === 'enterprise') {
    const started = await startComposeServer({ port: listenPort(env), env });
    return { url: started.url, close: started.close };
  }
  const started = await startKotowariServer({
    dataDir: env['KOTOWARI_DATA_DIR'] ?? '.kotowari',
    port: listenPort(env),
  });
  return { url: started.url, close: started.close };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startFromEnvironment().then((started) => {
    process.stdout.write(`Kotowari listening on ${started.url}\n`);
  });
}
