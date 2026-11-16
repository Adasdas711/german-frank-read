// Runs the given npm scripts one after another, keeps going after a failure,
// prints a summary and exits non-zero if any of them failed.
//
// KNOWN_FAILING=1   the suites are expected to fail: failures become
//             warnings and the exit code is 0; a suite that passes is
//             announced so it can move back into a regular group.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const names = process.argv.slice(2);
const known = process.env.KNOWN_FAILING === "1";
const annotate = (level, title, message) =>
  process.env.GITHUB_ACTIONS &&
  console.log(`::${level} title=${title}::${message}`);
const run = (name) => {
  console.log(`\n::group::${name}`);
  const { status } = spawnSync("npm", ["run", "-s", name], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  console.log("::endgroup::");
  return status === 0;
};
const results = [];
for (const name of names) {
  const started = Date.now();
  const status = run(name) ? "PASS" : "FAIL";
  results.push({ name, status, seconds: (Date.now() - started) / 1000 });
}
console.log("\nSummary:");
const lines = results.map(
  (r) => `${r.status.padEnd(5)}  ${r.name}  (${r.seconds.toFixed(0)} s)`,
);
for (const line of lines) console.log(line);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    "```\n" + lines.join("\n") + "\n```\n",
  );
for (const r of results) {
  if (known && r.status === "FAIL")
    annotate(
      "warning",
      "Known failing test",
      `${r.name} still fails (see tests/ci-groups.json)`,
    );
  else if (known)
    annotate(
      "notice",
      "Known failing test passes",
      `${r.name} now passes: move it from knownFailing into a group in tests/ci-groups.json`,
    );
  else if (r.status === "FAIL")
    annotate("error", "Browser test failed", `${r.name} failed`);
}
const failed = results.filter((r) => r.status === "FAIL");
if (failed.length && !known) {
  console.log(`\n${failed.length} of ${results.length} suites failed.`);
  process.exit(1);
}
