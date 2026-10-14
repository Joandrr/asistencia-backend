import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

const MAX_WORKERS = 8;
const MIN_ITEMS_PER_WORKER = 8;

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { hashSync } = require(workerData.bcryptPath);
parentPort.postMessage(workerData.values.map((value) => hashSync(value, workerData.cost)));
`;

/**
 * Hashes many passwords with bcrypt using worker threads, so large imports
 * neither block the event loop nor take minutes at the default cost.
 * Results keep the same order as the input.
 */
export async function hashPasswords(
  values: string[],
  cost: number,
): Promise<string[]> {
  if (values.length === 0) return [];
  const workers = Math.max(
    1,
    Math.min(
      availableParallelism() - 1,
      MAX_WORKERS,
      Math.ceil(values.length / MIN_ITEMS_PER_WORKER),
    ),
  );
  const chunkSize = Math.ceil(values.length / workers);
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  const results = await Promise.all(
    chunks.map((chunk) => hashInWorker(chunk, cost)),
  );
  return results.flat();
}

function hashInWorker(values: string[], cost: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { values, cost, bcryptPath: require.resolve('bcryptjs') },
    });
    worker.once('message', (hashes: string[]) => resolve(hashes));
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Hash worker exited with code ${code}`));
    });
  });
}
