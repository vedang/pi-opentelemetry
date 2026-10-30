import { resolve } from "node:path";
import { expect, it } from "vitest";
import { loadPackage } from "./fixtures/package-load.ts";

it("installed Pi loads the disabled package offline without stdout or telemetry", async () => {
  const result = await loadPackage(
    process.cwd(),
    resolve("node_modules/.bin/pi"),
  );
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});
