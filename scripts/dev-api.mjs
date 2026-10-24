// Starts the local Python (FastAPI) backend for `npm run dev`, on any OS.
// It finds backend/.venv (creating it and installing requirements on first run), then runs backend/run.py on :5000.
// Local only — the Vercel deployment never runs this; it talks to the hosted API.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const win = process.platform === 'win32';
const venvPython = join(backend, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: backend, stdio: 'inherit', ...opts });
const works = (cmd, args = []) => spawnSync(cmd, [...args, '--version'], { stdio: 'ignore' }).status === 0;

if (!existsSync(venvPython)) {
  const candidates = win ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
  const found = candidates.find(([cmd, args]) => works(cmd, args));
  if (!found) {
    console.error('[api] Python 3 was not found. Install Python 3.11+ from https://www.python.org/downloads/ and run `npm run dev` again.');
    process.exit(1);
  }
  console.log('[api] First run: creating backend/.venv and installing requirements (a few minutes)…');
  if (run(found[0], [...found[1], '-m', 'venv', '.venv']).status !== 0) process.exit(1);
  if (run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt']).status !== 0) process.exit(1);
}

const api = spawn(venvPython, ['run.py'], { cwd: backend, stdio: 'inherit' });
api.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => api.kill());
