export function onPreBuild({ netlifyConfig }) {
  if (process.env.CMS_ENABLED !== "1" || process.env.CMS_STORAGE === "local") return;
  // Netlify supplies ephemeral Blobs access to plugins, but not build commands.
  const context = process.env.NETLIFY_BLOBS_CONTEXT;
  if (context) netlifyConfig.build.environment.NETLIFY_BLOBS_CONTEXT = context;
}
