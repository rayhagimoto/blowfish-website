import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { onPreBuild } from "../../netlify/plugins/cms-storage/index.js";

const context = Buffer.from(JSON.stringify({ siteID: "test-site", deployID: "test-deploy", token: "test-build-token" })).toString("base64");

function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("CMS builds pass Netlify's plugin storage context to the real image-storage client in the build command", async (t) => {
  environment(t, { CMS_ENABLED: "1", CMS_STORAGE: "netlify", NETLIFY_BLOBS_CONTEXT: context });
  const netlifyConfig = { build: { environment: { EXISTING_SETTING: "preserved" } } };
  onPreBuild({ netlifyConfig });
  const storageModule = new URL("../../cms/storage.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { createStorage } from ${JSON.stringify(storageModule)}; const storage = await createStorage({ storageMode: "netlify" }); console.log(typeof storage.get);`], {
    env: netlifyConfig.build.environment,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "function");
  assert.equal(netlifyConfig.build.environment.EXISTING_SETTING, "preserved");
});

test("disabled and local CMS builds do not receive plugin storage credentials", (t) => {
  environment(t, { CMS_ENABLED: "0", CMS_STORAGE: "netlify", NETLIFY_BLOBS_CONTEXT: context });
  const netlifyConfig = { build: { environment: {} } };
  onPreBuild({ netlifyConfig });
  assert.deepEqual(netlifyConfig.build.environment, {});
  process.env.CMS_ENABLED = "1";
  process.env.CMS_STORAGE = "local";
  onPreBuild({ netlifyConfig });
  assert.deepEqual(netlifyConfig.build.environment, {});
});
