import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export async function retainReports(reports: string) {
  const entries = await readdir(reports, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^[a-f0-9]{16}\.json$/.test(entry.name))
      .map(async (entry) => ({
        path: join(reports, entry.name),
        info: await stat(join(reports, entry.name)),
      })),
  );
  files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  let size = 0;
  const kept = new Set<string>();
  for (const [index, file] of files.entries()) {
    const imagePath = file.path.replace(/\.json$/, ".png");
    const imageInfo = await stat(imagePath).catch(() => null);
    size += file.info.size + (imageInfo?.size ?? 0);
    if (index >= 5 || size > 100 * 1024 * 1024) {
      await rm(file.path);
    } else kept.add(file.path.replace(/\.json$/, ""));
  }
  for (const entry of entries)
    if (
      entry.isFile() &&
      /^[a-f0-9]{16}\.png$/.test(entry.name) &&
      !kept.has(join(reports, entry.name.replace(/\.png$/, "")))
    )
      await rm(join(reports, entry.name));
}
