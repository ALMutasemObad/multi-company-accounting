import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const forbidden = [
  new RegExp(`(?<![\\p{L}\\p{N}_])${["جو", "ار"].join("")}(?![\\p{L}\\p{N}_])`, "iu"),
  new RegExp(`(?<![A-Za-z0-9])${["j", "[aeiou]", "wa{1,2}r"].join("")}(?![A-Za-z0-9])`, "iu"),
  new RegExp(`(?<![\\p{L}\\p{N}_])${["ज", "(?:ि)?", "वार"].join("")}(?![\\p{L}\\p{N}_])`, "iu"),
];

function candidateFiles() {
  return execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
}

test("tracked product artifacts do not restore the retired brand", () => {
  const findings = [];
  for (const relativePath of candidateFiles()) {
    if (forbidden.some((pattern) => pattern.test(relativePath))) {
      findings.push(`${relativePath}: filename`);
      continue;
    }
    const contents = readFileSync(path.join(projectRoot, relativePath));
    if (contents.includes(0)) continue;
    const text = contents.toString("utf8");
    if (forbidden.some((pattern) => pattern.test(text))) findings.push(relativePath);
  }
  assert.deepEqual(findings, []);
});
