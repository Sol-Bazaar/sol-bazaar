/**
 * Zero-admin local Postgres for development.
 *
 * Docker is the nicer option, but it needs a working Docker Desktop, which is a
 * common blocker on a fresh machine. This runs a real PostgreSQL 17 server from
 * the `embedded-postgres` binaries, so the app talks to exactly the same
 * database it will in production — no substitute, no in-memory shim.
 *
 *   npm run db:local start     # initdb (first run) + start on :5432
 *   npm run db:local stop      # stop
 *   npm run db:local status
 *
 * Data lives in ./.pgdata (git-ignored). Remove that directory to reset.
 */
import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('.pgdata');
const PORT = Number(process.env.LOCAL_PG_PORT ?? 5432);
const DB = process.env.LOCAL_PG_DB ?? 'solbazaar';
const USER = process.env.LOCAL_PG_USER ?? 'solbazaar';
const PASSWORD = process.env.LOCAL_PG_PASSWORD ?? 'solbazaar_dev_password';

// Matches the DATABASE_URL in .env.example.
const URL = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB}?schema=public`;

function fresh(): boolean {
  return !existsSync(path.join(DATA_DIR, 'PG_VERSION'));
}

async function main() {
  const cmd = process.argv[2] ?? 'start';

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    // UTF-8 is not optional here: initdb inherits the Windows system code page,
    // which would be WIN1252, and the catalogue stores flag emoji. Without this
    // every insert of a non-Latin1 character fails.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {}, // keep our own output clean
    onError: (msg: unknown) => console.error('[postgres]', String(msg)),
  });

  switch (cmd) {
    case 'start': {
      const isNew = fresh();
      console.log(`▸ PostgreSQL ${isNew ? '(initialising)' : '(starting existing cluster)'} on port ${PORT}…`);
      // `initialise()` runs initdb, which fails if the data directory already
      // exists. Only run it on a first start.
      if (isNew) await pg.initialise();
      await pg.start();
      if (isNew) {
        await pg.createDatabase(DB);
        console.log(`   created database "${DB}"`);
      }
      console.log(`\n✅ PostgreSQL ready`);
      console.log(`   DATABASE_URL="${URL}"`);
      if (isNew) {
        console.log(`\n   Add that to your .env, then:  npm run db:push && npm run db:seed`);
      }
      console.log(`   Stop it with:                 npm run db:local stop\n`);
      // Hold the process open — the child server dies with us.
      const shutdown = async () => {
        console.log('\n▸ stopping PostgreSQL…');
        await pg.stop().catch(() => undefined);
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return;
    }

    case 'stop': {
      // pg_ctl is the supported path for shutting down an already-running server.
      const { execFileSync } = await import('node:child_process');
      const bin = path.join(
        process.cwd(),
        'node_modules/@embedded-postgres/windows-x64/native/bin',
      );
      try {
        execFileSync(
          path.join(bin, 'pg_ctl.exe'),
          ['-D', DATA_DIR, '-m', 'fast', 'stop'],
          { stdio: 'inherit' },
        );
        console.log('✅ PostgreSQL stopped');
      } catch (e) {
        console.error(`✖ Could not stop PostgreSQL: ${(e as Error).message}`);
        process.exitCode = 1;
      }
      return;
    }

    case 'status': {
      const running = await pg.isRunning().catch(() => false);
      console.log(running ? `● running on port ${PORT}` : `○ not running`);
      if (fresh()) console.log('  (never initialised — run `npm run db:local start`)');
      return;
    }

    default:
      console.error('Usage: npm run db:local [start|stop|status]');
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\n✖ ${e?.message ?? e}\n`);
  process.exit(1);
});