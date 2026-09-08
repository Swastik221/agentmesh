import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const output = process.env.SCREENSHOT_DIR || '/private/tmp/agentmesh-identity';
await mkdir(output, { recursive: true });

const readIdentity = (page) =>
  page.locator('#identity .chapter-scene').evaluate((scene) => {
    const value = (name) => Number(scene.style.getPropertyValue(`--identity-${name}`));
    const bounds = (selector) => {
      const rect = scene.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return {
      progress: Number(scene.dataset.identityProgress),
      wallet: value('wallet'),
      owner: value('owner'),
      verified: value('verified'),
      branch: value('branch'),
      agent: value('agent'),
      capabilities: [1, 2, 3, 4].map((index) => value(`cap-${index}`)),
      walletBounds: bounds('.identity-wallet'),
      ownerBounds: bounds('.identity-owner'),
      agentBounds: bounds('.identity-agent'),
      characterBounds: bounds('.coder-desk'),
      caption: scene.querySelector('.scene-stage').textContent,
      walletText: scene.querySelector('.identity-wallet').textContent,
      ownerText: scene.querySelector('.identity-owner').textContent,
      agentText: scene.querySelector('.identity-agent').textContent,
    };
  });

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(process.env.LANDING_URL || 'http://127.0.0.1:5173/landing');
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#identity .story-cover').scrollIntoViewIfNeeded();

    await page.waitForFunction(
      () =>
        Number(document.querySelector('#identity .chapter-scene').dataset.identityProgress) > 0.08,
    );
    const walletStage = await readIdentity(page);
    assert.ok(
      walletStage.wallet > walletStage.owner,
      `${width}: wallet leads the identity sequence`,
    );

    await page.waitForFunction(
      () =>
        Number(document.querySelector('#identity .chapter-scene').dataset.identityProgress) > 0.56,
    );
    const branchStage = await readIdentity(page);
    assert.ok(branchStage.owner > 0.9, `${width}: ENS owner resolves before agent identity`);
    assert.ok(branchStage.verified > 0.9, `${width}: ENS verification is visible`);
    assert.ok(branchStage.branch > 0, `${width}: agent identity branches from owner`);

    await page.evaluate(() => scrollBy(0, 180));
    await page.waitForTimeout(220);
    await page.evaluate(() => scrollBy(0, -180));
    const afterWheel = await readIdentity(page);
    assert.ok(
      afterWheel.progress >= branchStage.progress,
      `${width}: scroll cannot reverse identity`,
    );

    await page.waitForFunction(
      () =>
        Number(document.querySelector('#identity .chapter-scene').dataset.identityProgress) === 1,
      undefined,
      { timeout: 10_000 },
    );
    const end = await readIdentity(page);
    assert.ok(
      end.capabilities.every((value) => value > 0.99),
      `${width}: permissions complete`,
    );
    assert.match(end.walletText, /0x1a2b\.\.\.9f3c/);
    assert.match(end.ownerText, /dev1\.eth/);
    assert.match(end.agentText, /codex\.dev1\.eth/);
    assert.match(end.agentText, /deploy:approval-required/);
    assert.match(end.caption, /HUMAN-OWNED IDENTITY/);
    assert.ok(
      end.walletBounds.bottom <= end.ownerBounds.top + 2,
      `${width}: wallet and owner do not overlap`,
    );
    assert.ok(
      end.ownerBounds.bottom <= end.agentBounds.top + 2,
      `${width}: owner and agent do not overlap`,
    );
    assert.ok(
      end.agentBounds.right <= end.characterBounds.left + 2,
      `${width}: identity graph stays clear of developer (${end.agentBounds.right} <= ${end.characterBounds.left})`,
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/identity-${width}.png` });
    await page.close();
  }

  const reduced = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await reduced.emulateMedia({ reducedMotion: 'reduce' });
  await reduced.goto(process.env.LANDING_URL || 'http://127.0.0.1:5173/landing');
  await reduced.locator('#identity .story-cover').scrollIntoViewIfNeeded();
  const finalFrame = await readIdentity(reduced);
  assert.equal(finalFrame.progress, 1);
  assert.ok(finalFrame.capabilities.every((value) => value > 0.99));
  await reduced.close();

  console.log(
    'PASS: Identity builds wallet → verified ENS owner → derived agent → scoped permissions once, stays stable while scrolling, and resolves reduced motion.',
  );
} finally {
  await browser.close();
}
