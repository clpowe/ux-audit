import { withSession, VIEWPORTS } from "./sessions";
import { render } from "./render";

const url = process.argv[2];
if (!url) {
  console.error("usage: bun run peek <url> [--all] [--mobile]");
  process.exit(1);
}

const all = process.argv.includes("--all");
const mobile = process.argv.includes("--mobile");

await withSession({ url, viewport: mobile ? VIEWPORTS.mobile : VIEWPORTS.desktop }, async (page) => {
  const nodes = await page.snapshot({ all });
  console.log(render(nodes));
  console.error(`\n${nodes.length} nodes${all ? " (unfiltered)" : " (filtered)"}`);

  await Bun.write("out/peek.png", await page.screenshot());
  console.error("screenshot → out/peek.png");
});
