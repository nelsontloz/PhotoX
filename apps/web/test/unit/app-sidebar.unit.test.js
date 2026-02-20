import { getSidebarItems } from "../../app/components/app-sidebar";

describe("app sidebar navigation", () => {
  it("shows only timeline and upload for non-admin users", () => {
    expect(getSidebarItems(false)).toEqual([
      { href: "/timeline", label: "Timeline", icon: "photo_library" },
      { href: "/upload", label: "Upload", icon: "cloud_upload" }
    ]);
  });

  it("includes admin link for admin users", () => {
    expect(getSidebarItems(true)).toEqual([
      { href: "/timeline", label: "Timeline", icon: "photo_library" },
      { href: "/upload", label: "Upload", icon: "cloud_upload" },
      { href: "/admin", label: "Admin", icon: "admin_panel_settings" }
    ]);
  });
});

