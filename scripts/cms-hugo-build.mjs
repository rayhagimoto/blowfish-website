import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportFromEnvironment } from "./cms-export.mjs";

export async function buildHugo({ rootDir = process.cwd(), env = process.env, hugo = "hugo", args = [] } = {}) {
  const exported = await exportFromEnvironment({ rootDir, env });
  const cmsArgs = exported ? ["--configDir", exported.configDir, "--cleanDestinationDir"] : [];
  if (exported) console.log(`Building ${exported.posts} published CMS posts and ${exported.galleryImages ?? "repository"} gallery images.`);
  return new Promise((resolve, reject) => {
    const child = spawn(hugo, [...cmsArgs, "--gc", "--minify", ...args], { cwd: rootDir, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve(exported) : reject(new Error(`Hugo build failed (${signal ?? code})`)));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildHugo({ hugo: process.env.HUGO_BINARY ?? "hugo", args: process.argv.slice(2) })
    .catch((error) => { console.error(error.code === "ENOENT" ? "Hugo is unavailable. Install the configured Hugo version before building." : "CMS/Hugo build failed; deployment has stopped."); process.exitCode = 1; });
}
