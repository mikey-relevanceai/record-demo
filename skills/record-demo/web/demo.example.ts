// Example demo script. Copy to demo.ts and rewrite the steps for your change.
//
// Author it the way a person uses the app: find controls by their visible role
// and text (getByRole, getByText, getByLabel, getByPlaceholder), not by CSS or
// test hooks. The Human helpers add the natural motion, pacing, and the visible
// cursor - you describe the flow, they perform it.
//
// Never pad with `page.waitForTimeout(...)` to let something load - that dead air
// goes straight into the video. Hand `goto` a `ready` locator, or call
// `human.waitFor(...)`, and the demo continues the moment the app is there.
//
// Run it, warming the pages the demo visits so their first compile happens
// before capture starts:
//   PR_RECORDER_BASE_URL=http://localhost:3000 \
//   PR_RECORDER_WARMUP=/home,/files \
//   pnpm record demo.ts

import type { DemoContext } from "./record.ts";

export default async function demo({ page, human }: DemoContext): Promise<void> {
  await human.goto("/home", { ready: page.getByRole("link", { name: "Files" }) });
  await human.caption("Opening the files page");

  // Find things like a human would - by what the control says.
  await human.click(page.getByRole("link", { name: "Files" }));

  await human.caption("Creating a file");
  await human.click(page.getByRole("button", { name: "New" }));
  await human.type(page.getByPlaceholder("Untitled"), "Quarterly report");
  await human.click(page.getByRole("button", { name: "Create" }));

  await human.caption("Done");
  await human.settle(1200);
  await human.clearCaption();
}
