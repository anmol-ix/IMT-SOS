import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.DEPLOY_BOOTSTRAP_DATABASE_ROLES === "1") {
  console.log("Bootstrapping restricted database roles for this deployment.");
  run("npm", ["run", "db:roles"]);
}

run("npm", ["run", "db:migrate"]);
