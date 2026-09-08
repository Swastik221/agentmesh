import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.goto(process.env.LANDING_URL || 'http://127.0.0.1:5173/landing');
  await page.waitForSelector('#coordination .coord-workflow');
  const root = page.locator('#coordination');
  const counts = await root.evaluate((node) => ({
    agents: node.querySelectorAll('.coord-agent').length,
    cursors: node.querySelectorAll('.coord-cursor').length,
    tasks: node.querySelectorAll('.coord-board > g').length,
    chips: node.querySelectorAll('.coord-chip').length,
    captions: node.querySelectorAll('.coord-caption').length,
    people: node.querySelectorAll('.scene-character').length,
  }));
  assert.deepEqual(counts, { agents: 2, cursors: 2, tasks: 4, chips: 6, captions: 7, people: 0 });
  assert.equal(
    await page.locator('#agents .flat-coder').count(),
    1,
    'Agents chapter remains intact',
  );

  async function seek(progress) {
    await root.evaluate((node, p) => {
      const runway = node.querySelector('.chapter-runway');
      const cover = node.querySelector('.chapter-cover');
      const top = scrollY + runway.getBoundingClientRect().top;
      scrollTo(0, top - 86 + (runway.offsetHeight - cover.offsetHeight) * p);
    }, progress);
    await page.waitForFunction(
      ({ p }) => {
        const cover = document.querySelector('#coordination .chapter-cover');
        return (
          Math.abs(Number(getComputedStyle(cover).getPropertyValue('--cover-progress')) - p) < 0.003
        );
      },
      { p: progress },
    );
    return root.evaluate((node) => {
      const scene = node.querySelector('.scene--coordination');
      const value = (name) => Number(scene.style.getPropertyValue(`--coord-${name}`));
      return {
        counts: {
          agents: node.querySelectorAll('.coord-agent').length,
          cursors: node.querySelectorAll('.coord-cursor').length,
          tasks: node.querySelectorAll('.coord-board > g').length,
          chips: node.querySelectorAll('.coord-chip').length,
          captions: node.querySelectorAll('.coord-caption').length,
          people: node.querySelectorAll('.scene-character').length,
        },
        values: [
          'presence',
          'proposal',
          'choose',
          'claim',
          'dependency',
          'handoff',
          'complete',
        ].map(value),
        cursors: [...node.querySelectorAll('.coord-cursor')].map((item) =>
          item.getAttribute('transform'),
        ),
        tokens: [...node.querySelectorAll('.coord-task-token')].map((item) =>
          item.getAttribute('transform'),
        ),
        dependency: getComputedStyle(node.querySelector('.coord-dependency-base')).strokeDashoffset,
        artifact: node.querySelector('.coord-artifact').getAttribute('transform'),
      };
    });
  }

  const entering = await seek(0.01);
  const entered = await seek(0.1);
  assert.notDeepEqual(
    entering.cursors,
    entered.cursors,
    'developer cursors enter from opposite sides',
  );
  const frames = [];
  for (const p of [0.05, 0.17, 0.32, 0.45, 0.57, 0.71, 0.9]) frames.push(await seek(p));
  frames.forEach((frame) =>
    assert.deepEqual(frame.counts, counts, 'all coordination elements stay mounted'),
  );
  assert.ok(frames[1].values[1] > 0, 'task proposals draw after presence');
  assert.notDeepEqual(frames[2].cursors, frames[1].cursors, 'both humans move to choose work');
  assert.notDeepEqual(frames[2].tokens, frames[1].tokens, 'task cards follow the human cursors');
  assert.ok(frames[3].values[3] > 0, 'task claims follow selection');
  assert.ok(frames[4].values[4] > 0 && frames[4].values[5] === 0, 'dependency precedes artifact');
  assert.ok(frames[5].values[5] > 0, 'artifact moves from Vega to Orion');
  assert.ok(frames[6].values[6] > 0, 'final state unblocks Orion');

  const reverse = await seek(0.32);
  reverse.values.forEach((value, index) =>
    assert.ok(
      Math.abs(value - frames[2].values[index]) < 0.07,
      'reverse restores the coordinated state',
    ),
  );
  await seek(0.8);
  await page.screenshot({ path: '/private/tmp/agentmesh-coordination-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await seek(0.95);
  await page.screenshot({ path: '/private/tmp/agentmesh-coordination-mobile.png' });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'mobile has no horizontal overflow',
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.waitForSelector('#coordination .coord-workflow');
  const reduced = await root.evaluate((node) => ({
    progress: Number(
      getComputedStyle(node.querySelector('.chapter-cover')).getPropertyValue('--cover-progress'),
    ),
    complete: Number(
      node.querySelector('.scene--coordination').style.getPropertyValue('--coord-complete'),
    ),
  }));
  assert.deepEqual(reduced, { progress: 1, complete: 1 });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: two-person coordination, claims, dependency, handoff, reverse, responsive and reduced motion.',
  );
} finally {
  await browser.close();
}
