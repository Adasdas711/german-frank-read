import { build, transformWithEsbuild } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFile, writeFile, rm, mkdir, copyFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
await writeFile(
  "src/wasm-base64.txt",
  gzipSync(await readFile("node_modules/espeak-ng/dist/espeak-ng.wasm"), {
    level: 9,
  }).toString("base64"),
);
for (const [entry, name] of [
  ["reader", "index.html"],
  ["builder", "fbook-builder.html"],
]) {
  await build({
    configFile: false,
    plugins: [viteSingleFile()],
    build: {
      outDir: ".build-" + entry,
      emptyOutDir: true,
      target: "es2022",
      rollupOptions: { input: `${entry}-dev.html` },
      chunkSizeWarningLimit: 30000,
    },
    esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  });
  const licenses = [
    "COPYING",
    "licenses/Golos-Text-OFL.txt",
    "licenses/Literata-OFL.txt",
    ...(entry === "reader"
      ? [
          "lora",
          "merriweather",
          "pt-serif",
          "source-serif-4",
          "noto-serif",
          "inter",
          "pt-sans",
        ].map((name) => `licenses/${name}-OFL.txt`)
      : []),
    "licenses/Preact-MIT.txt",
    "licenses/fflate-MIT.txt",
    ...(entry === "builder" ? ["licenses/PDFjs-Apache-2.0.txt"] : []),
  ];
  const notice =
    "Немецкий по Франку · GPL-3.0-or-later. Source: accompanying src/, scripts/, package-lock.json. eSpeak source: https://github.com/ianmarmour/espeak-ng.js\n" +
    (await Promise.all(licenses.map((p) => readFile(p, "utf8")))).join("\n\n");
  let html = await readFile(`.build-${entry}/${entry}-dev.html`, "utf8");
  const script = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
  if (!script) throw Error("Missing bundled application script");
  // A module in <head> waits for the entire 13 MB document. Run a small classic
  // bundle in <body> before the inert WASM tail instead, including on Pages.
  const app = await transformWithEsbuild(script[1], "app.js", {
    format: "iife",
    minify: true,
    target: "es2022",
    define: { "import.meta.url": "location.href" },
  });
  const boot = await readFile("src/boot.js", "utf8");
  html = html
    .replace(script[0], "")
    .replace("<head>", "<head><script>" + boot + "</script>");
  const wasm = await readFile("src/wasm-base64.txt", "utf8");
  html = html.replace(
    "</body>",
    () =>
      "<script>" +
      app.code.replaceAll("</script", "<\\/script") +
      "</script>" +
      '<script id="espeak-wasm" type="application/octet-stream">' +
      wasm +
      "</script></body>",
  );
  // Keep the doctype first. Legal text belongs at the end, off the first paint.
  await writeFile(
    name,
    html + "\n<!--\n" + notice.replaceAll("-->", "-- >") + "\n-->\n",
  );
  await rm(".build-" + entry, { recursive: true });
  console.log(
    name,
    ((await readFile(name)).length / 1024 / 1024).toFixed(2) + " MiB",
  );
}
