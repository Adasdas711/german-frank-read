import { build } from "vite";
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
    "licenses/Preact-MIT.txt",
    "licenses/fflate-MIT.txt",
    ...(entry === "builder" ? ["licenses/PDFjs-Apache-2.0.txt"] : []),
  ];
  const notice =
    "Немецкий по Франку · GPL-3.0-or-later. Source: accompanying src/, scripts/, package-lock.json. eSpeak source: https://github.com/ianmarmour/espeak-ng.js\n" +
    (await Promise.all(licenses.map((p) => readFile(p, "utf8")))).join("\n\n");
  await writeFile(
    name,
    "<!--\n" +
      notice.replaceAll("-->", "-- >") +
      "\n-->\n" +
      (await readFile(`.build-${entry}/${entry}-dev.html`, "utf8")),
  );
  await rm(".build-" + entry, { recursive: true });
  console.log(
    name,
    ((await readFile(name)).length / 1024 / 1024).toFixed(2) + " MiB",
  );
}
