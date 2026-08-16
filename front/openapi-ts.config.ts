import { defineConfig } from "@hey-api/openapi-ts";

/**
 * The room's types come from the service that serves it.
 *
 * FastAPI writes `control/openapi.json` from the code itself (`poe openapi`),
 * and this turns that into TypeScript. A field renamed on the Python side
 * therefore fails `tsc` here, instead of arriving as `undefined` in a browser
 * where nothing checks it. That is the whole reason for the generator, and the
 * reason ADR D6 keeps it after the control plane replaced the hand-written page.
 */
export default defineConfig({
  input: "../control/openapi.json",
  output: { path: "src/client", format: false, lint: false },
  plugins: ["@hey-api/client-fetch"],
});
