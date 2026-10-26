import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HistoryEntrySchema, mergeHistory, type HistoryEntry } from ".";

// File-backed history for the local server (git-ignored .data/history.json). Moves to the Neon
// database (build step 9) once DATABASE_URL is provided; the API stays the same.

const FILE = path.join(process.cwd(), ".data", "history.json");

export async function readHistory(): Promise<HistoryEntry[]> {
  try {
    const parsed = z.array(HistoryEntrySchema).safeParse(JSON.parse(await readFile(FILE, "utf8")));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

// One write at a time, so two uploads at once can't lose each other's rows.
let queue: Promise<unknown> = Promise.resolve();

export function addToHistory(entries: HistoryEntry[]): Promise<HistoryEntry[]> {
  const run = queue.then(async () => {
    const next = mergeHistory(await readHistory(), entries);
    await mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next));
    await rename(tmp, FILE);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
