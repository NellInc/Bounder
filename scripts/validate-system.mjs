import { isMainModule, loadSystemModel } from "./lib/system-model.mjs";

export async function runSystemCheck(logger = console) {
  const model = await loadSystemModel();
  logger.log(`System descriptor valid: ${model.roles.length} roles, ${model.components.length} components, ${model.artifacts.length} artifacts, ${model.impact_rules.length} impact rules`);
  return model;
}

if (isMainModule(import.meta.url)) {
  runSystemCheck().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
