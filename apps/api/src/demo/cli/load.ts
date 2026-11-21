import { readFile } from "node:fs/promises";
import { dataDirectory } from "../../http/config.js";
import { InvalidIncidentFile, readIncidentBytes } from "../../source/input.js";
import { writeDemoFiles } from "../data.js";

async function main(args: string[]): Promise<void> {
  const [option, input] = args;
  if (args.length !== 2 || option !== "--file" || !input) {
    console.error("Использование: npm run data:load -- --file PATH");
    process.exitCode = 1;
    return;
  }

  const dataDir = dataDirectory(process.env);
  try {
    const bytes = await readFile(input);
    const count = readIncidentBytes(bytes).length;
    await writeDemoFiles(dataDir, bytes);
    console.log(`Загружено записей: ${count}. Каталог данных: ${dataDir}`);
  } catch (error) {
    console.error(error instanceof InvalidIncidentFile ? error.message : "Не удалось загрузить исходный набор.");
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
