import { spawnSync } from "node:child_process";

const message = process.argv.slice(2).join(" ").trim() || `Auto commit ${new Date().toISOString()}`;

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout?.trim() ?? "";
}

const branch = git(["branch", "--show-current"], { capture: true });

if (!branch) {
  console.error("Unable to determine the current Git branch.");
  process.exit(1);
}

git(["add", "--all"]);

const status = git(["status", "--porcelain"], { capture: true });

if (!status) {
  console.log("No changes to commit.");
} else {
  git(["commit", "-m", message]);
}

git(["push", "--set-upstream", "origin", branch]);
