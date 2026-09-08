import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const output = process.env.SCREENSHOT_DIR || '/private/tmp/agentmesh-developers';
await mkdir(output, { recursive: true });

const readScene = (page) =>
  page.locator('#developers .chapter-scene').evaluate((scene) => {
    const value = (name) => Number(scene.style.getPropertyValue(`--developers-${name}`));
    const bounds = (selector) => {
      const rect = scene.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const storyCover = scene.closest('.story-cover');
    const cover = storyCover.getBoundingClientRect();
    const heading = storyCover.querySelector('.chapter-heading h2').getBoundingClientRect();
    return {
      progress: Number(scene.dataset.developersProgress),
      editor: value('editor'),
      code: [1, 2, 3].map((index) => value(`code-${index}`)),
      events: [1, 2, 3].map((index) => value(`event-${index}`)),
      origin: value('origin'),
      spine: value('spine'),
      trace: value('trace'),
      editorBounds: bounds('.developer-editor'),
      eventBounds: bounds('.developer-event-2'),
      characterBounds: bounds('.coder-desk'),
      coverBounds: { left: cover.left, right: cover.right },
      headingBounds: { left: heading.left, right: heading.right, bottom: heading.bottom },
      caption: scene.querySelector('.scene-stage').textContent,
      text: scene.querySelector('.scene-objects').textContent,
    };
  });

try {
  for (const width of [2260, 1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : width === 2260 ? 1392 : 1000 },
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(process.env.LANDING_URL || 'http://127.0.0.1:5173/landing');
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#developers .story-cover').scrollIntoViewIfNeeded();

    await page.waitForFunction(
      () =>
        Number(document.querySelector('#developers .chapter-scene').dataset.developersProgress) >
        0.12,
    );
    const writing = await readScene(page);
    assert.ok(writing.editor > writing.events[0], `${width}: local editor appears before events`);

    await page.waitForFunction(
      () =>
        Number(document.querySelector('#developers .chapter-scene').dataset.developersProgress) >
        0.62,
    );
    const publishing = await readScene(page);
    assert.ok(
      publishing.code.every((value) => value > 0.99),
      `${width}: code is written first`,
    );
    assert.ok(publishing.events[0] > publishing.events[2], `${width}: events append in order`);
    assert.ok(publishing.origin > 0.99, `${width}: event stream is linked to local work`);

    await page.evaluate(() => scrollBy(0, 180));
    await page.waitForTimeout(220);
    await page.evaluate(() => scrollBy(0, -180));
    const afterWheel = await readScene(page);
    assert.ok(afterWheel.progress >= publishing.progress, `${width}: scroll cannot reverse trace`);

    await page.waitForFunction(
      () =>
        Number(document.querySelector('#developers .chapter-scene').dataset.developersProgress) ===
        1,
      undefined,
      { timeout: 10_000 },
    );
    const end = await readScene(page);
    assert.ok(
      end.events.every((value) => value > 0.99),
      `${width}: all events are visible`,
    );
    assert.ok(end.spine > 0.99, `${width}: event spine completes`);
    assert.ok(end.trace > 0.99, `${width}: trace receipt completes`);
    assert.match(end.text, /TASK_PROPOSED/);
    assert.match(end.text, /ARTIFACT_PUBLISHED/);
    assert.match(end.text, /REVIEW_REQUESTED/);
    assert.match(end.text, /dev1\.eth · Orion · AM-115/);
    assert.match(end.text, /payment-api\.json · v1 · inspectable/);
    assert.match(end.caption, /INSPECTABLE/);
    assert.ok(
      end.headingBounds.right + 18 <= end.editorBounds.left ||
        end.headingBounds.bottom <= end.editorBounds.top,
      `${width}: title/editor overlap (${end.headingBounds.right} + 18 <= ${end.editorBounds.left}; ${end.headingBounds.bottom} <= ${end.editorBounds.top})`,
    );
    assert.ok(
      end.eventBounds.right <= end.coverBounds.right,
      `${width}: event rail stays in frame`,
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/developers-${width}.png` });
    await page.close();
  }

  const reduced = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await reduced.emulateMedia({ reducedMotion: 'reduce' });
  await reduced.goto(process.env.LANDING_URL || 'http://127.0.0.1:5173/landing');
  await reduced.locator('#developers .story-cover').scrollIntoViewIfNeeded();
  const finalFrame = await readScene(reduced);
  assert.equal(finalFrame.progress, 1);
  assert.ok(finalFrame.events.every((value) => value > 0.99));
  assert.ok(finalFrame.trace > 0.99);
  await reduced.close();

  console.log(
    'PASS: Developers writes locally, appends a linked event trace, requests review, then holds an inspectable final record on desktop and mobile.',
  );
} finally {
  await browser.close();
}
