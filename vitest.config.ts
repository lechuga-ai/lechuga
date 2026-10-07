import { defineConfig } from "vitest/config";

// Unit tests for the worker's pure functions (the credit sums, the
// attachment format, the webhook signature, the address check): the
// files beside the code they test, named *.test.ts. The end-to-end
// scripts against a running copy are in eval/. `npm test` runs these.
export default defineConfig({
  test: {
    include: ["worker/src/**/*.test.ts"],
  },
});
