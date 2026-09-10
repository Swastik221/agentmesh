// Optional Chromium regression; see docs/landing-page.md for environment settings.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const origin = process.env.LANDING_URL || 'http://127.0.0.1:5173/landing';
const output = process.env.SCREENSHOT_DIR || '/private/tmp/agentmesh-scroll';
await mkdir(output, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  external = [],
  paintings = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (/\/health|\/api\/|api.openai|api.anthropic/.test(request.url())) external.push(request.url());
  if (request.url().includes('/paintings/')) paintings.push(request.url());
});
/**
 * The scenes trail the wheel deliberately, so a fixed number of frames is not
 * enough to read a settled value. Wait until two consecutive frames paint the
 * same thing, which is also the assertion that motion actually comes to rest.
 */
async function settle() {
  const moving = await page.evaluate(async () => {
    // Only the scenes the wheel actually drives. The shared canvas and Chapter
    // II run on their own clocks now, so they are never at rest and would keep
    // this waiting forever.
    const sample = () =>
      JSON.stringify([
        document.querySelector('.mesh-intro')?.dataset.progress,
        [...document.querySelectorAll('.chapter-cover, [data-scroll-visual]')].map(
          (node) => node.style.cssText,
        ),
      ]);
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    let previous = '';
    // Several identical frames, not one: near the end of a damped move the
    // per-frame change is small enough that a single repeat can be a sampling
    // artefact rather than the scene having actually stopped.
    let stable = 0;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      await frame();
      const current = sample();
      stable = current === previous ? stable + 1 : 0;
      previous = current;
      if (stable >= 5) return false;
    }
    return true;
  });
  assert.ok(!moving, 'scroll scenes come to rest after the wheel stops');
}
/**
 * A late refresh (fonts, a deferred chunk) can move a pinned section's scroll
 * range after it was read, so the requested position is confirmed against the
 * progress the scene actually reports and retried against the new range.
 */
async function scrollScene(selector, progress) {
  const section = page.locator(selector);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [start, end] = await section.evaluate((root) => [
      Number(root.dataset.scrollStart),
      Number(root.dataset.motionEnd || root.dataset.scrollEnd),
    ]);
    await page.evaluate((y) => scrollTo(0, y), start + (end - start) * progress);
    await settle();
    const reached = Number(await section.evaluate((root) => root.dataset.progress));
    if (Math.abs(reached - progress) < 0.002) return;
  }
  assert.fail(`${selector} never reached progress ${progress}`);
}
async function introFrame() {
  return page.locator('.mesh-intro').evaluate((root) => ({
    stage: root.dataset.stage,
    arm: root.querySelector('.coder-forearm').getAttribute('d'),
    wire: root.querySelector('.intro-wire').style.strokeDashoffset,
    border: root.querySelector('.intro-border rect').style.opacity,
    burst: root.querySelector('.intro-burst').style.opacity,
    headline: getComputedStyle(root.querySelector('.intro-headline')).opacity,
    coder: root.style.getPropertyValue('--intro-coder'),
    cardOpacity: getComputedStyle(root.querySelector('.intro-agent')).opacity,
    card: root.querySelector('.intro-agent').style.transform,
    header: getComputedStyle(document.querySelector('.landing-header')).visibility,
  }));
}
async function canvasFrame() {
  return page.locator('#workspace').evaluate((root) => ({
    progress: root.dataset.progress,
    nodes: [...root.querySelectorAll('.react-flow__node')].map((node) => [
      node.dataset.id,
      node.style.transform,
      node.textContent,
    ]),
    edges: [...root.querySelectorAll('.canvas-drawing-edge')].map((edge) => [
      edge.getAttribute('d'),
      edge.getAttribute('stroke-dashoffset'),
    ]),
    cursors: [...root.querySelectorAll('.workspace-cursor')].map((node) => node.style.transform),
    packet: root.querySelector('.canvas-schema-packet').style.cssText,
  }));
}
try {
  await page.goto(origin);
  await page.locator('#workspace[data-progress]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.landing img').count(), 0, 'all classical paintings removed');
  assert.equal(await page.locator('.landing .react-flow').count(), 1, 'only one workspace canvas');
  assert.equal(await page.locator('.canvas-demo').count(), 0, 'duplicate lower demo removed');
  const openingOrder = await page.evaluate(() => ({
    heroTop: Math.round(document.querySelector('#top').getBoundingClientRect().top),
    heroHeight: Math.round(document.querySelector('#top').getBoundingClientRect().height),
    animationTop: Math.round(document.querySelector('.mesh-intro').getBoundingClientRect().top),
    contentCenter: Math.round(
      document.querySelector('#top .hero-copy').getBoundingClientRect().top +
        document.querySelector('#top .hero-copy').getBoundingClientRect().height / 2,
    ),
    viewportCenter: Math.round(innerHeight / 2),
  }));
  assert.equal(openingOrder.heroTop, 0, 'headline owns the first viewport');
  assert.ok(
    openingOrder.animationTop >= openingOrder.heroHeight - 1,
    'connection animation starts one page below the headline',
  );
  assert.match(await page.locator('#top').innerText(), /Your agents\. One team\./);
  assert.ok(
    Math.abs(openingOrder.contentCenter - openingOrder.viewportCenter) <= 2,
    'hero content is vertically centered as one group',
  );
  await page.screenshot({ path: `${output}/opening-hero.png` });
  const introScrollScreens = await page.locator('.mesh-intro').evaluate((root) => {
    const start = Number(root.dataset.scrollStart);
    const end = Number(root.dataset.scrollEnd);
    return (end - start) / innerHeight;
  });
  assert.ok(
    introScrollScreens >= 5.19 && introScrollScreens <= 5.21,
    'the opening includes the original motion plus a two-viewport completed hold',
  );
  const intro = [];
  for (const [name, p] of [
    ['rest', 0],
    ['reach', 0.35],
    ['connection', 0.6],
    ['burst', 0.81],
    ['headline', 1],
  ]) {
    await scrollScene('.mesh-intro', p);
    intro.push(await introFrame());
    await page.screenshot({ path: `${output}/opening-${name}.png` });
  }
  assert.ok(Number(intro[0].wire) > 0.999, 'wire starts visually undrawn');
  assert.equal(intro[0].headline, '0');
  assert.equal(intro[0].header, 'visible');
  await scrollScene('.mesh-intro', 0.03);
  const firstMotion = await introFrame();
  assert.equal(firstMotion.stage, 'reaching');
  assert.notEqual(firstMotion.arm, intro[0].arm, 'the first scroll immediately moves the coder');
  assert.ok(Number(firstMotion.wire) < 1, 'the first scroll immediately starts drawing the wire');
  assert.notEqual(intro[0].arm, intro[1].arm);
  assert.notEqual(intro[0].card, intro[1].card);
  assert.ok(Number(intro[1].wire) > 0 && Number(intro[1].wire) < 1);
  assert.ok(Number(intro[2].border) > 0);
  assert.equal(intro[2].burst, '0');
  assert.ok(Number(intro[3].burst) > 0);
  assert.equal(intro[3].headline, '0');
  await scrollScene('.mesh-intro', 0.88);
  const cleanHandoff = await introFrame();
  assert.ok(Number(cleanHandoff.coder) < 0.001, 'coder clears before the result appears');
  assert.ok(
    Number(cleanHandoff.cardOpacity) < 0.001,
    'agent cards clear before the result appears',
  );
  assert.equal(cleanHandoff.headline, '0', 'result starts from a clean handoff frame');
  assert.ok(Number(cleanHandoff.burst) > 0, 'connection glow bridges the two scenes');
  await page.screenshot({ path: `${output}/opening-clean-handoff.png` });
  await scrollScene('.mesh-intro', 0.94);
  const resultHandoff = await introFrame();
  assert.equal(resultHandoff.coder, '0');
  assert.equal(resultHandoff.cardOpacity, '0');
  assert.ok(Number(resultHandoff.headline) > 0, 'result reveals after the previous scene clears');
  await page.screenshot({ path: `${output}/opening-result-handoff.png` });
  assert.equal(intro[4].coder, '0');
  assert.equal(intro[4].headline, '1');
  assert.equal(intro[4].header, 'visible');
  assert.match(
    await page.locator('.connection-outcome').innerText(),
    /payment-api\.json[\s\S]*Two independent coding agents/,
  );
  await scrollScene('.mesh-intro', 1);
  assert.ok(
    await page
      .locator('#workspace')
      .evaluate((node) => node.getBoundingClientRect().top >= innerHeight - 1),
    'canvas follows the completed headline',
  );
  const completedFrame = await introFrame();
  await page.locator('.mesh-intro').evaluate((root) => {
    scrollTo(0, Number(root.dataset.motionEnd) + innerHeight * 1.5);
  });
  await settle();
  assert.deepEqual(await introFrame(), completedFrame, 'completed result holds for two scrolls');
  await page.locator('.mesh-intro').evaluate((root) => {
    scrollTo(0, Number(root.dataset.scrollEnd) + innerHeight * 0.25);
  });
  await settle();
  assert.ok(
    await page
      .locator('#workspace')
      .evaluate((node) => node.getBoundingClientRect().top < innerHeight),
    'the next page moves in after the two-scroll hold',
  );
  await scrollScene('.mesh-intro', 0.35);
  assert.deepEqual(await introFrame(), intro[1]);
  await page.waitForTimeout(300);
  assert.deepEqual(await introFrame(), intro[1]);
  console.log(
    'Opening: hero order, moving agents, wires, generated workspace result and reversal passed.',
  );
  // The shared canvas plays itself once when it comes into view, so it is
  // watched over time rather than scrubbed. Its own page, because by this point
  // in the main run it has already played.
  const demo = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const demoErrors = [];
  demo.on('pageerror', (error) => demoErrors.push(error.message));
  await demo.goto(origin);
  await demo.evaluate(() => document.fonts.ready);
  const readCanvas = () =>
    demo.locator('#workspace').evaluate((root) => ({
      progress: Number(root.dataset.progress),
      live: root.querySelector('.scroll-canvas').dataset.live,
      counts: [
        root.querySelectorAll('.react-flow__node').length,
        root.querySelectorAll('.workspace-cursor').length,
        root.querySelectorAll('.canvas-drawing-edge').length,
        root.querySelectorAll('.canvas-attribution').length,
      ],
      nodes: Object.fromEntries(
        [...root.querySelectorAll('.react-flow__node')].map((node) => {
          const rect = node.getBoundingClientRect();
          return [node.dataset.id, [Math.round(rect.x), Math.round(rect.y)]];
        }),
      ),
      // Canvas-space rather than viewport-space, so a different page scroll
      // offset does not read as the canvas having moved.
      placed: Object.fromEntries(
        [...root.querySelectorAll('.react-flow__node')].map((node) => [
          node.dataset.id,
          node.style.transform,
        ]),
      ),
      cursors: [...root.querySelectorAll('.workspace-cursor')].map((node) => {
        const rect = node.getBoundingClientRect();
        return [Math.round(rect.x), Math.round(rect.y)];
      }),
      edges: [...root.querySelectorAll('.canvas-drawing-edge')].map((edge) =>
        Number(edge.getAttribute('stroke-dashoffset')),
      ),
      // Within each stack of lines — the caption, and each attribution pill —
      // at most one may be legible at a time. Overlapping them printed two
      // sentences on top of each other in the same place.
      loud: [
        root.querySelector('.workspace-caption'),
        ...root.querySelectorAll('.canvas-attribution-lines'),
      ].map(
        (stack) =>
          [...stack.children].filter((line) => Number(getComputedStyle(line).opacity) > 0.25)
            .length,
      ),
      text: [...root.querySelectorAll('.react-flow__node')]
        .map((node) => node.textContent)
        .join(' '),
    }));
  // Bring it into view; the demo starts itself from there.
  await demo.locator('#workspace').scrollIntoViewIfNeeded();
  const reel = [];
  for (let tick = 0; tick < 32; tick += 1) {
    reel.push(await readCanvas());
    await demo.waitForTimeout(500);
  }
  assert.ok(reel[0].progress < 0.2, 'the demo is watched from its start');
  const finished = reel.at(-1);
  assert.equal(finished.progress, 1, 'the demo reaches its end on its own');
  assert.equal(finished.live, 'true', 'the canvas is handed over once the demo ends');
  assert.match(finished.text, /Dependency connected/);
  for (let tick = 1; tick < reel.length; tick += 1) {
    const now = reel[tick],
      before = reel[tick - 1],
      at = `${(tick * 0.5).toFixed(1)}s in`;
    assert.deepEqual(now.counts, reel[0].counts, `nothing mounts or unmounts ${at}`);
    assert.ok(now.progress >= before.progress, `the demo only ever runs forwards ${at}`);
    now.loud.forEach((count, stack) =>
      assert.ok(count <= 1, `stack ${stack} shows one line at a time ${at}`),
    );
    // Wires only ever draw further in.
    now.edges.forEach((level, i) =>
      assert.ok(level <= before.edges[i] + 0.001, `wire ${i} only draws in ${at}`),
    );
  }
  // The terminals were carried, and by their own pointer.
  const moved = (id) =>
    Math.hypot(
      finished.nodes[id][0] - reel[0].nodes[id][0],
      finished.nodes[id][1] - reel[0].nodes[id][1],
    );
  assert.ok(moved('orion') > 40 && moved('vega') > 40, 'both terminals are carried into place');
  assert.ok(
    reel[0].edges.every((edge) => edge === 1),
    'no wire is drawn at the start',
  );
  assert.ok(
    finished.edges.every((edge) => edge === 0),
    'every wire is drawn at the end',
  );
  await demo.screenshot({ path: `${output}/workspace-live.png` });
  // Handed over: a terminal can be dragged, and the wheel does not rewind it.
  const orion = demo.locator('#workspace .react-flow__node[data-id=orion]');
  const grip = await orion.boundingBox();
  await demo.mouse.move(grip.x + 110, grip.y + 25);
  await demo.mouse.down();
  await demo.mouse.move(grip.x + 150, grip.y + 55, { steps: 8 });
  await demo.mouse.up();
  await demo.waitForTimeout(200);
  assert.ok((await orion.boundingBox()).x > grip.x + 20, 'the finished canvas is draggable');
  const parked = await readCanvas();
  await demo.evaluate(() => scrollBy(0, -400));
  await demo.waitForTimeout(500);
  await demo.locator('#workspace').scrollIntoViewIfNeeded();
  await demo.waitForTimeout(500);
  assert.equal((await readCanvas()).progress, 1, 'scrolling never rewinds the demo');
  assert.deepEqual(
    (await readCanvas()).placed,
    parked.placed,
    'scrolling does not move the canvas',
  );
  assert.deepEqual(demoErrors, []);
  await demo.close();
  console.log(
    'Shared canvas: plays itself once on view, only forwards, one line of copy at a time, both terminals carried, then handed over draggable and wheel-proof.',
  );

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.waitForTimeout(450);
    // Chapters II and IV–VI run on their own clocks and are checked separately.
    for (const id of ['coordination']) {
      const runway = page.locator(`#${id} .chapter-runway`);
      const [top, range] = await runway.evaluate((node) => [
        node.getBoundingClientRect().top + scrollY - 86,
        node.offsetHeight - node.firstElementChild.offsetHeight,
      ]);
      const scene = page.locator(`#${id} .chapter-scene`);
      // A chapter's moving part is its coder's arm where it has one, and its
      // travelling object where it does not — Chapter III currently renders no
      // figure, so read whichever the scene actually has.
      const pose = () =>
        scene.evaluate((node) => [
          node.style.cssText,
          node.querySelector('.coder-forearm')?.getAttribute('d') ??
            node.querySelector('.scene-parcel')?.getAttribute('transform') ??
            '',
          node.querySelector('.scene-stage').textContent,
        ]);
      await page.evaluate((y) => scrollTo(0, y), top + range * 0.2);
      await settle();
      const first = await pose();
      await page.evaluate((y) => scrollTo(0, y), top + range * 0.85);
      await settle();
      const last = await pose();
      assert.notDeepEqual(first, last, `${id} has a moving role-specific scene`);
      await page.screenshot({ path: `${output}/scene-${id}-${width}.png` });
      await page.evaluate((y) => scrollTo(0, y), top + range * 0.2);
      await settle();
      assert.deepEqual(await pose(), first, `${id} reverses`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  }
  console.log('The coordination chapter keeps reversible native pinning on desktop and mobile.');

  // Chapter II plays itself too, so it is checked against its own clock rather
  // than the wheel. Its own page, because by this point in the main run it
  // played minutes ago and the assembly is what needs watching.
  const shop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await shop.goto(origin);
  await shop.evaluate(() => document.fonts.ready);
  const workshopTop = await shop
    .locator('#agents .chapter-runway')
    .evaluate((node) => node.getBoundingClientRect().top + scrollY - 86);
  await shop.evaluate((y) => scrollTo(0, y), workshopTop);
  const readWorkshop = () =>
    shop.locator('#agents .chapter-scene').evaluate((scene) => {
      const value = (name) => Number(scene.style.getPropertyValue(`--agents-${name}`)) || 0;
      const fade = (selector) => Number(getComputedStyle(scene.querySelector(selector)).opacity);
      return {
        vars: Object.fromEntries(
          [
            'settle',
            'typing',
            'line-1',
            'line-4',
            'wire',
            'connection',
            'card',
            'border',
            'ready',
            'traffic',
          ].map((name) => [name, value(name)]),
        ),
        counts: [
          scene.querySelectorAll('.scene-code-line').length,
          scene.querySelectorAll('.scene-agent-connection').length,
          scene.querySelectorAll('.scene-data-packet').length,
          scene.querySelectorAll('.scene-agent-border').length,
          scene.querySelectorAll('.flat-coder').length,
        ],
        fades: [
          '.scene-character',
          '.scene-float-a',
          '.scene-float-b',
          '.scene-agent-connection',
          '.scene-agent-border',
          '.scene-agent-ready',
        ].map(fade),
        arm: scene.querySelector('.coder-forearm').getAttribute('d'),
      };
    });
  const takes = [];
  for (let tick = 0; tick < 34; tick += 1) {
    takes.push(await readWorkshop());
    await shop.waitForTimeout(250);
  }
  for (let tick = 1; tick < takes.length; tick += 1) {
    const now = takes[tick],
      before = takes[tick - 1],
      at = `${(tick * 0.25).toFixed(2)}s in`;
    assert.deepEqual(now.counts, takes[0].counts, `nothing mounts or unmounts ${at}`);
    // Everything the scene establishes, it keeps: no ramp may ever fall back.
    for (const [name, level] of Object.entries(now.vars))
      assert.ok(level >= before.vars[name] - 0.002, `${name} is never taken away ${at}`);
    now.fades.forEach((level, i) =>
      assert.ok(level >= before.fades[i] - 0.02, `nothing fades back out ${at}`),
    );
  }
  const settled = takes.at(-1).vars;
  assert.ok(
    Object.values(settled).every((level) => level > 0.999),
    'the workshop reaches and holds its assembled state',
  );
  assert.ok(takes[0].vars.connection < 0.05, 'the workshop starts from unassembled');
  // Alive after assembly: the hands keep typing on the scene's own clock.
  const late = takes.slice(-12);
  assert.ok(
    new Set(late.map((f) => f.arm)).size > 6,
    'the hands keep moving after the scene has settled',
  );
  // And it owes nothing to the wheel — scrolling past and back changes nothing.
  const beforeWheel = await readWorkshop();
  await shop.evaluate((y) => scrollTo(0, y), workshopTop + 600);
  await shop.waitForTimeout(400);
  await shop.evaluate((y) => scrollTo(0, y), workshopTop);
  await shop.waitForTimeout(400);
  const afterWheel = await readWorkshop();
  assert.deepEqual(afterWheel.vars, beforeWheel.vars, 'scrolling does not rewind the workshop');
  await shop.screenshot({ path: `${output}/workshop-settled.png` });
  await shop.close();
  console.log(
    'Chapter II: assembles on its own clock in about 5s, never un-draws, keeps typing once settled, and ignores the wheel entirely.',
  );
  await page.locator('#start').scrollIntoViewIfNeeded();
  await settle();
  assert.equal(await page.locator('#start .flat-coder').count(), 2);
  assert.equal(
    await page.locator('#start .coder-eyes-open').count(),
    2,
    'both closing coders have animated eyes',
  );
  assert.equal(
    await page.locator('#start .coder-eyes-closed').count(),
    2,
    'both closing coders have a closed blink frame',
  );
  const blinkCycles = await page.locator('#start .coder-eyes-open').evaluateAll((eyes) =>
    eyes.map((eye) => {
      const style = getComputedStyle(eye);
      return [style.animationName, style.animationDuration, style.animationDelay];
    }),
  );
  assert.deepEqual(
    blinkCycles.map(([name, duration]) => [name, duration]),
    [
      ['coder-eyes-open', '4.8s'],
      ['coder-eyes-open', '4.8s'],
    ],
    'both coders blink on a natural interval',
  );
  assert.notEqual(blinkCycles[0][2], blinkCycles[1][2], 'paired coders blink out of phase');
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(450);
    await scrollScene('.mesh-intro', 0);
    await page.screenshot({ path: `${output}/layout-${width}.png` });
    // The canvas answers to its own clock, so it is simply brought into view.
    await page.locator('#workspace').scrollIntoViewIfNeeded();
    await settle();
    await page.screenshot({ path: `${output}/canvas-${width}.png` });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `no overflow at ${width}`,
    );
  }
  await page.waitForFunction(
    () => document.querySelector('#workspace')?.dataset.progress === '1',
    null,
    { timeout: 15_000 },
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => scrollTo(0, 0));
  await settle();
  assert.equal(await page.locator('.pin-spacer').count(), 0);
  assert.equal((await introFrame()).headline, '1');
  assert.equal(await page.locator('#workspace').getAttribute('data-progress'), '1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await settle();
  assert.equal(
    await page.locator('.pin-spacer').count(),
    1,
    'the opening is the only pinned sequence; the canvas plays on its own clock',
  );
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await settle();
  assert.equal((await introFrame()).header, 'visible');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(paintings, []);
  console.log(
    'Feature motion to the footer, controls, five sizes, reduced motion, keyboard skip, no paintings, errors or backend calls passed.',
  );
} finally {
  await browser.close();
}
