import { open, readFile, rename } from "node:fs/promises";
import { Writable } from "node:stream";

// Two rotating segments retain recent output within one per-process disk budget.
export async function createBoundedLog(path: string, budget = 1024 * 1024) {
  if (!Number.isInteger(budget) || budget < 2) throw new Error("Invalid log budget");
  const segment = Math.floor(budget / 2);
  let file = await open(path, "w");
  let written = 0;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await file.close();
  }
  async function append(chunk: Buffer) {
    for (let offset = 0; offset < chunk.length; ) {
      if (written === segment) {
        await close();
        await rename(path, `${path}.previous`);
        file = await open(path, "w");
        closed = false;
        written = 0;
      }
      const part = chunk.subarray(offset, offset + segment - written);
      await file.writeFile(part);
      written += part.length;
      offset += part.length;
    }
  }
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      void append(chunk).then(() => callback(), callback);
    },
    final(callback) {
      void close().then(() => callback(), callback);
    },
    destroy(error, callback) {
      void close().then(() => callback(error), callback);
    },
  });
}

export async function readLogTail(path: string, bytes: number) {
  const parts = await Promise.all(
    [`${path}.previous`, path].map(async (name) => {
      try {
        return await readFile(name);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT")
          return Buffer.alloc(0);
        throw error;
      }
    }),
  );
  return Buffer.concat(parts).subarray(-bytes).toString("utf8");
}
