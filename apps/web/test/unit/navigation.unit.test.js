import { buildLoginPath, resolveNextPath, shouldAutoRedirectAuthenticatedAuthPage } from "../../lib/navigation";

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

  it("auto-redirects authenticated auth-page visits without next", () => {
    expect(shouldAutoRedirectAuthenticatedAuthPage({ hasAccessToken: true, hasNextParam: false })).toBe(true);
  });

  it("does not auto-redirect when login has next parameter", () => {
    expect(shouldAutoRedirectAuthenticatedAuthPage({ hasAccessToken: true, hasNextParam: true })).toBe(false);
  });

  it("does not auto-redirect when user is unauthenticated", () => {
    expect(shouldAutoRedirectAuthenticatedAuthPage({ hasAccessToken: false, hasNextParam: false })).toBe(false);
  });
});
