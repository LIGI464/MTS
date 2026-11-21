import { describe, expect, it } from "vitest";
import { itsmHref } from "../itsm";

describe("itsmHref", () => {
  it("собирает локальный адрес, если внешнего шаблона нет", () => {
    expect(itsmHref({ id: "INC000000000003", itsmUrl: null })).toBe("/itsm/incidents/INC000000000003");
    expect(itsmHref({ id: "a/b c", itsmUrl: "" })).toBe("/itsm/incidents/a%2Fb%20c");
  });

  it("сохраняет внешний https без учётных данных", () => {
    const href = "https://itsm.example/incidents/INC000000000003";
    expect(itsmHref({ id: "INC000000000003", itsmUrl: href })).toBe(href);
  });

  it("не принимает http, пароль в адресе и не-URL", () => {
    expect(itsmHref({ id: "INC1", itsmUrl: "http://itsm.example/incidents/INC1" })).toBe("/itsm/incidents/INC1");
    expect(itsmHref({ id: "INC1", itsmUrl: "https://user:secret@itsm.example/incidents/INC1" })).toBe(
      "/itsm/incidents/INC1",
    );
    expect(itsmHref({ id: "INC1", itsmUrl: "javascript:alert(1)" })).toBe("/itsm/incidents/INC1");
  });
});
