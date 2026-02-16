import { buildLoginPath, resolveNextPath } from "../../lib/navigation";

describe("navigation helpers", () => {
  it("resolves safe next path", () => {
    expect(resolveNextPath("/upload")).toBe("/upload");
    expect(resolveNextPath("/albums")).toBe("/albums");
  });

  it("falls back for empty or unsafe paths", () => {
    expect(resolveNextPath("")).toBe("/timeline");
    expect(resolveNextPath("https://bad.example")).toBe("/timeline");
    expect(resolveNextPath("//evil")).toBe("/timeline");
  });

  it("builds login redirect path", () => {
    expect(buildLoginPath("/upload")).toBe("/login?next=%2Fupload");
  });
});
