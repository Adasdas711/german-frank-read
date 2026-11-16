// Runs the given npm scripts one after another, keeps going after a failure,
// prints a summary and exits non-zero if any of them failed.
import { spawnSync } from "node:child_process";

const names = process.argv.slice(2);
const results = [];
for (const name of names) {
  const started = Date.now();
  console.log(`\n::group::${name}`);
  const { status } = spawnSync("npm", ["run", "-s", name], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  console.log("::endgroup::");
  results.push({
    name,
    ok: status === 0,
    seconds: (Date.now() - started) / 1000,
  });
}
console.log("\nSummary:");
for (const r of results)
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.seconds.toFixed(0)} s)`,
  );
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n${failed.length} of ${results.length} suites failed.`);
  process.exit(1);
}
