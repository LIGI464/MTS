import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RawIncidentsSchema } from "@mts/contracts";
import { describe, expect, it } from "vitest";

const sourceFile = [process.env.MTS_SOURCE_FILE, resolve("character_problems.json"), resolve("data/local/character_problems.json")]
  .filter((item): item is string => typeof item === "string" && item.length > 0)
  .find((item) => existsSync(item));

describe.skipIf(!sourceFile)("local MTS export", () => {
  it("accepts 44 records, five Research rows, and three Research rows without a deadline", () => {
    const payload: unknown = JSON.parse(readFileSync(sourceFile ?? "", "utf8").replace(/^\uFEFF/, ""));
    const records = RawIncidentsSchema.parse(payload);
    const research = records.filter((record) => record.stateEnum === "Research");
    expect(records).toHaveLength(44);
    expect(research).toHaveLength(5);
    expect(research.filter((record) => record.deadline == null)).toHaveLength(3);
    expect(research.filter((record) => typeof record.completionDate === "string")).toHaveLength(5);
  });
});
