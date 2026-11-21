import { describe, expect, it } from "vitest";
import { describeImportIssues } from "../import-validation";

const row = { id: "INC7", priorityId: 3, submitDate: "2026-11-21T09:00:00Z" };

describe("диагностика импорта", () => {
  it("принимает категорию «Наивысший» без числового приоритета", () => {
    const json = JSON.stringify([{ id: row.id, submitDate: row.submitDate, "Категория": "Наивысший" }]);
    expect(describeImportIssues(json, [])).toEqual([]);
  });

  it("показывает все ошибки с путями и идентификаторами поверх сокращённого ответа D24", () => {
    const rows = Array.from({ length: 24 }, (_, index) => ({ ...row, id: `INC-${index}`, priorityId: "3" }));
    const messages = Array.from({ length: 20 }, (_, index) => `Запись ${index + 1}, поле priorityId: некорректное значение.`);
    const issues = describeImportIssues(JSON.stringify(rows), [...messages, "Всего ошибок: 24."]);
    expect(issues).toHaveLength(24);
    expect(issues[23]).toEqual({
      row: 24, id: "INC-23", path: "$[23].priorityId", reason: "Укажите числовой приоритет от 1 до 4.",
    });
  });

  it("находит дубль вместе с ошибкой поля и указывает отсутствующий ID у записи неверного типа", () => {
    const json = JSON.stringify([row, { ...row, id: " INC7 ", submitDate: 0 }, "запись"]);
    const issues = describeImportIssues(json, ["Запись 2, поле submitDate: некорректное значение.", "Запись 3: ожидается объект заявки."]);
    expect(issues.map(({ row, id, path }) => [row, id, path])).toEqual([
      [2, "INC7", "$[1].submitDate"], [2, "INC7", "$[1].id"], [3, null, "$[2]"],
    ]);
    expect(issues[1].reason).toBe("ID уже встречался в файле.");
  });

  it("показывает корневую ошибку JSON и сохраняет диагностику только с сервера", () => {
    expect(describeImportIssues("{", ["Файл не содержит корректный JSON."])).toEqual([
      { row: null, id: null, path: "$", reason: "Файл не содержит корректный JSON." },
    ]);
    expect(describeImportIssues(JSON.stringify([row]), ["Запись 1, поле extra: неверный формат."])).toEqual([
      { row: 1, id: "INC7", path: "$[0].extra", reason: "неверный формат." },
    ]);
  });
});
