// Example desktop demo. Copy it outside the repository and rewrite the steps for
// your change. The labels below are placeholders: probe your app's real
// accessible names first (see SKILL.md) and replace them.
export default async function runDemo({ demo, page }) {
  await demo.click(page.getByRole("button", { name: "Settings" }), "Open Settings");
  await page.getByRole("heading", { name: "Settings" }).waitFor({ state: "visible" });
  await demo.screenshot("settings-open");
}
