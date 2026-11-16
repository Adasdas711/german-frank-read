// Checks that every browser suite in package.json is assigned to exactly one
// CI group (or to knownFailing), then prints the job matrices for GitHub
// Actions: `matrix=...` and `known=...` lines for $GITHUB_OUTPUT.
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const config = JSON.parse(await readFile("tests/ci-groups.json", "utf8"));
const suites = Object.keys(pkg.scripts).filter((name) =>
  name.startsWith("test:"),
);
const assigned = [
  ...Object.values(config.groups).flat(),
  ...config.knownFailing,
];
const problems = [];
for (const name of suites) {
  const count = assigned.filter((x) => x === name).length;
  if (count === 0) problems.push(`${name} is not in tests/ci-groups.json`);
  if (count > 1) problems.push(`${name} is listed ${count} times`);
}
for (const name of assigned)
  if (!suites.includes(name))
    problems.push(`${name} is listed but has no package.json script`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const matrix = {
  include: Object.entries(config.groups).map(([name, list]) => ({
    name,
    suites: list.join(" "),
  })),
};
console.log("matrix=" + JSON.stringify(matrix));
console.log("known=" + config.knownFailing.join(" "));
