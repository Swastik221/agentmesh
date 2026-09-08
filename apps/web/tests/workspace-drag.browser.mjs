const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5173/landing');
await page.waitForTimeout(1800);
async function at(p) {
  await page.evaluate((p) => {
    const e = document.querySelector('#workspace');
    scrollTo(0, +e.dataset.scrollStart + (+e.dataset.scrollEnd - +e.dataset.scrollStart) * p);
  }, p);
  await page.waitForTimeout(650);
  return page.evaluate(() => ({
    p: +document.querySelector('.scroll-canvas').dataset.canvasProgress,
    nodes: [...document.querySelectorAll('.scroll-canvas .react-flow__node-agent')].map((e) => ({
      transform: e.style.transform,
      rect: { x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y },
      text: e.textContent,
    })),
    cursors: [...document.querySelectorAll('.workspace-cursor')].map((e) => ({
      transform: e.style.transform,
      mode: e.dataset.mode,
    })),
    edges: [...document.querySelectorAll('.canvas-drawing-edge')].map((e) => e.getAttribute('d')),
  }));
}
for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 1000 });
  await page.waitForTimeout(600);
  for (const [i, a, b] of [
    [0, 0.33, 0.4],
    [1, 0.73, 0.79],
  ]) {
    const first = await at(a),
      second = await at(b);
    const xy = (s) =>
      s
        .match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
        .slice(1)
        .map(Number);
    const n1 = xy(first.nodes[i].transform),
      n2 = xy(second.nodes[i].transform),
      c1 = xy(first.cursors[i].transform),
      c2 = xy(second.cursors[i].transform);
    assert.equal(second.cursors[i].mode, 'drag');
    assert.ok(Math.abs(n1[1] - n2[1]) > 5);
    // The terminal travels with its pointer but trails it while the pointer is
    // moving, so the two deltas agree to within that lag rather than exactly.
    for (let axis = 0; axis < 2; axis++)
      assert.ok(Math.abs(n2[axis] - n1[axis] - (c2[axis] - c1[axis])) < 20);
    assert.notDeepEqual(first.edges, second.edges);
    const reverse = await at(a);
    assert.ok(Math.abs(xy(reverse.nodes[i].transform)[1] - n1[1]) < 1);
  }
  await at(0.95);
  await page.screenshot({ path: `/private/tmp/agentmesh-drag-${width}.png` });
}
await at(0.44);
assert.equal(await page.locator('.scroll-canvas').getByText('claimed', { exact: true }).count(), 0);
await at(0.46);
assert.equal(await page.locator('.scroll-canvas').getByText('claimed', { exact: true }).count(), 1);
await at(0.83);
assert.equal(await page.locator('.scroll-canvas').getByText('claimed', { exact: true }).count(), 2);
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.waitForTimeout(500);
assert.equal(await page.locator('.scroll-canvas').getAttribute('data-canvas-progress'), '1');
await page.goto('http://127.0.0.1:5173/');
await page.waitForTimeout(500);
assert.equal(await page.locator('.landing').count(), 0);
assert.deepEqual(errors, []);
console.log(
  'PASS: desktop/mobile attached dragging, moving edges, rewind, post-release claims, reduced motion and original route.',
);
await browser.close();
