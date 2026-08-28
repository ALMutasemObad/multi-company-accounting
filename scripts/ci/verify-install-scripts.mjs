let input = "";

process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

let report;
try {
  report = JSON.parse(input);
} catch {
  console.error("Invalid npm install-script report.");
  process.exit(1);
}

if (!report || typeof report !== "object" || Array.isArray(report)) {
  console.error("Invalid npm install-script report.");
  process.exit(1);
}

const pending = Object.values(report)
  .flatMap((value) => (Array.isArray(value) ? value : []))
  .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
  .sort();

if (pending.length) {
  console.error(`Unapproved install scripts: ${pending.join(", ")}`);
  process.exit(1);
}
