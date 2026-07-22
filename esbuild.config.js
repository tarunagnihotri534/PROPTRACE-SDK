// @ts-check
const esbuild = require("esbuild");
const path = require("path");

const args = process.argv.slice(2);
const isWatch = args.includes("--watch");
const isWebview = args.includes("--webview");

/** @type {import("esbuild").BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node16",
  sourcemap: true,
  minify: false,
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions} */
const webviewConfig = {
  entryPoints: ["src/webview/index.tsx"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: true,
  minify: false,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"development"',
  },
};

async function build() {
  const configs = isWebview
    ? [webviewConfig]
    : [extensionConfig, webviewConfig];

  if (isWatch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
