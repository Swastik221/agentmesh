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
  await page.waitForSelector('#agents .scene--agents');
  const root = page.locator('#agents');
  const initialCounts = await root.evaluate((node) => ({
    hands: node.querySelectorAll('.coder-hand').length,
    lines: node.querySelectorAll('.scene-code-line').length,
    cards: node.querySelectorAll('.scene-float-b').length,
    paths: node.querySelectorAll('.scene-agent-connection').length,
  }));

  async function seek(progress) {
    await root.evaluate((node, p) => {
      const runway = node.querySelector('.chapter-runway');
      const cover = node.querySelector('.chapter-cover');
      const top = scrollY + runway.getBoundingClientRect().top;
      scrollTo(0, top - 86 + (runway.offsetHeight - cover.offsetHeight) * p);
    }, progress);
    await page.waitForFunction(
      ({ p }) => {
        const cover = document.querySelector('#agents .chapter-cover');
        return Math.abs(Number(getComputedStyle(cover).getPropertyValue('--cover-progress')) - p) < 0.002;
      },
      { p: progress },
    );
    return root.evaluate((node) => {
      const scene = node.querySelector('.scene--agents');
      const value = (name) => Number(scene.style.getPropertyValue(name));
      return {
        counts: {
          hands: node.querySelectorAll('.coder-hand').length,
          lines: node.querySelectorAll('.scene-code-line').length,
          cards: node.querySelectorAll('.scene-float-b').length,
          paths: node.querySelectorAll('.scene-agent-connection').length,
        },
        vars: [
          '--agents-line-1', '--agents-line-2', '--agents-line-3', '--agents-line-4',
          '--agents-connection', '--agents-response',
        ].map(value),
        hands: [...node.querySelectorAll('.coder-hand')].map((hand) => hand.getAttribute('transform')),
        packet: Number(getComputedStyle(node.querySelector('.scene-data-packet')).opacity),
        waiting: Number(getComputedStyle(node.querySelector('.scene-agent-waiting')).opacity),
        ready: Number(getComputedStyle(node.querySelector('.scene-agent-ready')).opacity),
      };
    });
  }

  const frames = [];
  for (const p of [0, 0.18, 0.27, 0.38, 0.52, 0.68, 0.86, 1]) frames.push(await seek(p));
  frames.forEach((frame) => assert.deepEqual(frame.counts, initialCounts, 'animated elements stay mounted'));
  assert.notEqual(frames[2].hands[0], frames[2].hands[1], 'hands use offset typing poses');
  assert.ok(frames[2].vars[0] > 0 && frames[2].vars[1] === 0, 'code follows the first keystrokes');
  assert.ok(frames[4].vars[4] > 0 && frames[4].vars[5] === 0, 'connection follows editor activity');
  assert.ok(frames[6].vars[5] > 0 && frames[6].ready > frames[6].waiting, 'agent responds last');
  assert.ok(frames[5].packet > 0, 'data packet follows the drawn path');
  const reverse = await seek(0.38);
  reverse.vars.forEach((value, index) =>
    assert.ok(Math.abs(value - frames[3].vars[index]) < 0.05, 'reverse scroll restores the same coordinated state'),
  );
  await seek(0.86);
  await page.screenshot({ path: '/private/tmp/agentmesh-agents-final.png' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.waitForSelector('#agents .scene--agents');
  const reduced = await root.evaluate((node) => {
    const scene = node.querySelector('.scene--agents');
    return {
      progress: getComputedStyle(node.querySelector('.chapter-cover')).getPropertyValue('--cover-progress'),
      animation: getComputedStyle(node.querySelector('.coder-arm--left')).animationName,
      ready: getComputedStyle(node.querySelector('.scene-agent-ready')).opacity,
      line: scene.style.getPropertyValue('--agents-line-4'),
    };
  });
  assert.equal(Number(reduced.progress), 1);
  assert.equal(reduced.animation, 'none');
  assert.equal(Number(reduced.ready), 1);
  assert.equal(Number(reduced.line), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: coordinated typing, editor, connection, response, reverse scroll and reduced motion.');
} finally {
  await browser.close();
}
