// Collects the files the published site needs into _site/ (GitHub Pages).
// The app pages are self-contained; the rest is the PWA shell, the bundled
// books and the licence texts.
import { cp, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html",
  "fbook-builder.html",
  "sw.js",
  "manifest.webmanifest",
  ".nojekyll",
  "pwa",
  "books",
  "licenses",
  "COPYING",
  "THIRD_PARTY.md",
];
await rm("_site", { recursive: true, force: true });
await mkdir("_site");
for (const path of files) await cp(path, `_site/${path}`, { recursive: true });
console.log("Site files:", files.join(", "));
