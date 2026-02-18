import { countActiveAdmins } from "../../lib/admin-metrics";

describe("admin metrics helpers", () => {
  it("counts only users who are both admin and active", () => {
    const users = [
      { user: { isAdmin: true, isActive: true } },
      { user: { isAdmin: true, isActive: false } },
      { user: { isAdmin: false, isActive: true } },
      { user: { isAdmin: true, isActive: true } }
    ];

    expect(countActiveAdmins(users)).toBe(2);
  });

  it("returns zero for invalid or empty input", () => {
    expect(countActiveAdmins([])).toBe(0);
    expect(countActiveAdmins(null)).toBe(0);
    expect(countActiveAdmins(undefined)).toBe(0);
  });
});
