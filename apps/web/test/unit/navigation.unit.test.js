import { buildLoginPath, resolveNextPath } from "../../lib/navigation";

describe("navigation helpers", () => {
  it("resolves safe next path", () => {
    expect(resolveNextPath("/upload")).toBe("/upload");
    expect(resolveNextPath("/albums")).toBe("/albums");
  });

  it("falls back for empty or unsafe paths", () => {
    expect(resolveNextPath("")).toBe("/upload");
    expect(resolveNextPath("https://bad.example")).toBe("/upload");
    expect(resolveNextPath("//evil")).toBe("/upload");
  });

  it("builds login redirect path", () => {
    expect(buildLoginPath("/upload")).toBe("/login?next=%2Fupload");
  });
});
