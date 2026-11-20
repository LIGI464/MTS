import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDirectory } from "../../http/config.js";
import { atomicWrite } from "../../source/file.js";
import { InvalidIncidentFile, LIVE_FILENAME } from "../../source/input.js";
import { applyDemoStep, DEMO_STEPS, DemoStepError } from "../steps.js";

async function main(args: string[]): Promise<void> {
  const step = DEMO_STEPS.find((name) => name === args[0]);
  if (args.length !== 1 || !step) {
    console.error(`Использование: npm run demo:step -- ${DEMO_STEPS.join("|")}`);
    process.exitCode = 1;
    return;
  }

  const path = join(dataDirectory(process.env), LIVE_FILENAME);
  try {
    const bytes = await readFile(path);
    await atomicWrite(path, applyDemoStep(bytes, step));
    console.log(`Применён шаг ${step}.`);
  } catch (error) {
    console.error(error instanceof DemoStepError || error instanceof InvalidIncidentFile
      ? error.message
      : "Не удалось прочитать или обновить рабочий файл инцидентов.");
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
