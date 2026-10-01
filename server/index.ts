import { openDatabase } from './db.js';
import { buildApp, readConfiguration } from './app.js';

readConfiguration();
const db = openDatabase();
const app = await buildApp(db, { logger: true });
const shutdown = async () => { await app.close(); db.close(); process.exit(0); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
await app.listen({ host: process.env.HOST || '0.0.0.0', port: Number(process.env.PORT || 3000) });
