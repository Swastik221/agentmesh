import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const output = process.env.SCREENSHOT_DIR || '/private/tmp/agentmesh-control';
await mkdir(output, { recursive: true });

const readScene = (page) =>
  page.locator('#control .chapter-scene').evaluate((scene) => {
    const bounds = (selector) => {
      const rect = scene.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top };
    };
    const value = (name) => Number(scene.style.getPropertyValue(`--control-${name}`));
    return {
      progress: Number(scene.dataset.controlProgress),
      request: bounds('.scene-request'),
      boundary: bounds('.control-boundary'),
      character: bounds('.scene-character'),
      hand: bounds('.coder-arm--right .coder-hand'),
      hold: bounds('.coder-control-console'),
      scope: value('scope'),
      path: value('path'),
      boundaryStrength: value('boundary'),
      approval: value('approval'),
      press: value('press'),
      caption: scene.querySelector('.scene-stage').textContent,
      paused: scene.querySelector('.control-approval-state text').textContent,
    };
  });

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(process.env.LANDING_URL || 'http://127.0.0.1:5173/landing');
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#control .story-cover').scrollIntoViewIfNeeded();

    await page.waitForFunction(
      () =>
        Number(document.querySelector('#control .chapter-scene').dataset.controlProgress) > 0.08,
    );
    const start = await readScene(page);
    await page.waitForFunction(
      () => Number(document.querySelector('#control .chapter-scene').dataset.controlProgress) > 0.5,
    );
    const moving = await readScene(page);

    await page.evaluate(() => scrollBy(0, 180));
    await page.waitForTimeout(250);
    await page.evaluate(() => scrollBy(0, -180));
    const afterWheel = await readScene(page);
    assert.ok(
      afterWheel.progress >= moving.progress,
      `${width}: wheel never reverses the sequence`,
    );
    assert.ok(
      afterWheel.request.left >= moving.request.left,
      `${width}: request keeps moving forward`,
    );

    await page.waitForFunction(
      () =>
        Number(document.querySelector('#control .chapter-scene').dataset.controlProgress) > 0.76,
    );
    const reaching = await readScene(page);
    assert.ok(reaching.hand.left > start.hand.left, `${width}: hand reaches toward HOLD`);

    await page.waitForFunction(
      () => Number(document.querySelector('#control .chapter-scene').dataset.controlProgress) === 1,
      undefined,
      { timeout: 10_000 },
    );
    const end = await readScene(page);
    assert.ok(
      moving.request.left > start.request.left,
      `${width}: request travels toward boundary`,
    );
    assert.ok(end.request.left > moving.request.left, `${width}: request completes its travel`);
    assert.ok(
      end.request.right <= end.boundary.left + 2,
      `${width}: request cannot cross boundary`,
    );
    assert.ok(end.boundary.left - end.request.right < 24, `${width}: request stops at boundary`);
    assert.ok(end.scope > start.scope, `${width}: scope resolves`);
    assert.ok(end.path > moving.path, `${width}: policy path completes`);
    assert.ok(end.boundaryStrength > moving.boundaryStrength, `${width}: boundary strengthens`);
    assert.ok(end.approval > 0.99, `${width}: human approval checkpoint holds`);
    assert.ok(end.press > 0.99, `${width}: developer completes the HOLD press`);
    assert.ok(
      end.hand.right >= end.hold.left && end.hand.left <= end.hold.right,
      `${width}: hand lands on the HOLD control`,
    );
    assert.match(end.paused, /ACTION PAUSED/);
    assert.equal(end.character.left, start.character.left, `${width}: developer stays anchored`);
    assert.match(end.caption, /HUMAN DECIDES/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/control-${width}.png` });
    await page.close();
  }

  const reduced = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await reduced.emulateMedia({ reducedMotion: 'reduce' });
  await reduced.goto(process.env.LANDING_URL || 'http://127.0.0.1:5173/landing');
  await reduced.locator('#control .story-cover').scrollIntoViewIfNeeded();
  const finalFrame = await readScene(reduced);
  assert.equal(finalFrame.progress, 1);
  assert.ok(finalFrame.approval > 0.99);
  assert.ok(finalFrame.request.right <= finalFrame.boundary.left + 2);
  await reduced.close();

  console.log(
    'PASS: Control plays once independently of scrolling, the developer presses HOLD, the request stops at the boundary, and reduced motion resolves safely.',
  );
} finally {
  await browser.close();
}
