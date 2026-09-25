import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  DISTRICT_DISK_MAX_AGE_MS,
  DISTRICT_DISK_MAX_BYTES,
  DISTRICTS,
} from '../../src/layers/cwwp/policy.js';

/** Gitignored dev-server cache. Served stale, refreshed in the background. */
export const CWWP_DISK_DIR = path.join(process.cwd(), '.cache', 'gev-caltrans');

/**
 * One JSON file per district. Writes land in a temp file and rename into
 * place, so a crash cannot leave a half-written catalog as the live copy.
 */
export function createCwwpDiskCache({
  dir = CWWP_DISK_DIR,
  maxAgeMs = DISTRICT_DISK_MAX_AGE_MS,
  maxBytes = DISTRICT_DISK_MAX_BYTES,
  now = () => Date.now(),
} = {}) {
  function filePath(district) {
    return path.join(dir, `d${String(district).padStart(2, '0')}.json`);
  }

  async function read(district) {
    if (!DISTRICTS.includes(district)) return null;
    let raw;
    try {
      raw = await readFile(filePath(district), 'utf8');
    } catch {
      return null;
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      await rm(filePath(district), { force: true }).catch(() => {});
      return null;
    }
    const at = Number(payload?.at);
    const cameras = payload?.cameras;
    if (!Number.isFinite(at) || !Array.isArray(cameras)) {
      await rm(filePath(district), { force: true }).catch(() => {});
      return null;
    }
    if (now() - at > maxAgeMs) {
      await rm(filePath(district), { force: true }).catch(() => {});
      return null;
    }
    return { at, cameras };
  }

  async function evict() {
    let entries = [];
    try {
      const names = await readdir(dir);
      entries = await Promise.all(
        names
          .filter((name) => /^d\d+\.json$/.test(name))
          .map(async (name) => {
            const full = path.join(dir, name);
            const info = await stat(full);
            return { full, bytes: info.size, mtimeMs: info.mtimeMs };
          }),
      );
    } catch {
      return;
    }
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of entries) {
      if (total <= maxBytes) break;
      await rm(entry.full, { force: true }).catch(() => {});
      total -= entry.bytes;
    }
  }

  async function write(district, cameras, at = now()) {
    if (!DISTRICTS.includes(district) || !Array.isArray(cameras)) return;
    await mkdir(dir, { recursive: true });
    const finalPath = filePath(district);
    const tempPath = `${finalPath}.${process.pid}.tmp`;
    const body = JSON.stringify({ district, at, cameras });
    await writeFile(tempPath, body);
    await rename(tempPath, finalPath);
    await evict();
  }

  return { dir, read, write, evict };
}
