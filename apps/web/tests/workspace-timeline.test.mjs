import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEATS,
  beatOpacity,
  grip,
  workspaceTimeline,
} from '../src/features/landing/workspaceTimeline.ts';

const sample = (count, from = 0, to = 1) =>
  Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);
const CAPTION_RANGE = [0, 1, 2, 3, 4, 5, 6];
const DRAGS = [
  ['anandCursor', 'orionNode', 0.3, 0.45],
  ['swastikCursor', 'vegaNode', 0.7, 0.82],
];

for (const layout of ['desktop', 'tablet', 'phone']) {
  test(`${layout}: each cursor carries its terminal, trailing it and catching up on release`, () => {
    for (const [cursor, node, from, to] of DRAGS) {
      // `to` is the release itself, where the pointer has already let go.
      const frames = sample(40, from, to).slice(0, -1).map((p) => workspaceTimeline(p, layout));
      // The terminal hangs off the grip but lags behind it while the pointer is
      // moving, which is what reads as being dragged rather than teleported.
      const lag = frames.map((frame) =>
        Math.hypot(
          frame[cursor].x - frame[node].x - grip.x,
          frame[cursor].y - frame[node].y - grip.y,
        ),
      );
      assert.ok(Math.max(...lag) > 4, 'the terminal visibly trails its pointer mid-drag');
      assert.ok(Math.max(...lag) < 30, 'the terminal never comes loose from its pointer');
      assert.ok(lag[0] < 1.5 && lag.at(-1) < 1.5, 'the lag closes at both ends of the drag');
      // Nothing on the path may reverse or stall: the terminal travels once.
      const steps = frames
        .slice(1)
        .map((frame, i) =>
          Math.hypot(frame[node].x - frames[i][node].x, frame[node].y - frames[i][node].y),
        );
      assert.ok(Math.min(...steps) > 0, 'the terminal moves on every frame of the drag');
      for (const frame of frames) assert.equal(frame[cursor].mode, 'drag');
      // `selected` is the label, which hands over to `moved` as the drag
      // starts; `hold` is the grip itself, which lasts the whole way.
      assert.equal(frames[0][node].hold, 1, 'held for the whole drag');
    }
  });
}

test('the timeline is a pure function: scrolling back returns the same frame', () => {
  const up = sample(60).map((p) => workspaceTimeline(p));
  const down = sample(60)
    .toReversed()
    .map((p) => workspaceTimeline(p))
    .toReversed();
  assert.deepEqual(down, up);
});

test('every published value ramps rather than switching', () => {
  // 400 samples is finer than a wheel notch, so any value that snapped on a
  // threshold would show up here as a step the eye would read as a blink.
  const readings = (p) => {
    const frame = workspaceTimeline(p);
    return {
      // Canvas units. A pointer crosses about 240 of them during its approach,
      // so at this sampling rate its fastest legitimate step is roughly 16.
      travel: [frame.orionNode, frame.vegaNode, frame.anandCursor, frame.swastikCursor].flatMap(
        (thing) => [thing.x, thing.y],
      ),
      // Everything else is a 0-1 ramp and must move in fractions.
      ramps: [
        ...[frame.orionNode, frame.vegaNode].flatMap((node) => [
          node.hold,
          node.tilt / 3,
          node.selected,
          node.moved,
          node.working,
        ]),
        frame.anandCursor.hold,
        frame.swastikCursor.hold,
        ...frame.activeEdges.flatMap((edge) => [edge.draw, edge.arrive]),
        ...frame.taskEvents,
        frame.packet,
        frame.packetOpacity,
        ...CAPTION_RANGE.map((index) => beatOpacity(p, index)),
      ],
    };
  };
  const frames = sample(400).map(readings);
  for (let i = 1; i < frames.length; i += 1)
    for (const [key, limit] of [
      ['travel', 20],
      ['ramps', 0.12],
    ])
      frames[i][key].forEach((value, k) =>
        assert.ok(
          Math.abs(value - frames[i - 1][key][k]) <= limit,
          `${key} ${k} stepped ${(value - frames[i - 1][key][k]).toFixed(3)} at progress ${(i / 400).toFixed(3)}`,
        ),
      );
});

test('captions hand over in sequence and never print over each other', () => {
  for (const p of sample(400)) {
    const opacities = CAPTION_RANGE.map((index) => beatOpacity(p, index));
    const total = opacities.reduce((sum, value) => sum + value, 0);
    assert.ok(total <= 1.02, `never more than one caption's worth of copy at ${p}`);
    // The outgoing line is gone before the incoming one arrives. Crossfading
    // them put two sentences on top of each other at every boundary.
    assert.ok(
      opacities.filter((value) => value > 0.25).length <= 1,
      `never two legible captions at ${p}`,
    );
  }
  // Each beat owns the middle of its own range outright.
  BEATS.forEach((beat, index) => {
    assert.equal(beatOpacity(beat + 0.05, index + 1), 1);
    assert.equal(beatOpacity(beat - 0.05, index + 1), 0);
  });
});

test('claims and the artifact wait for their release', () => {
  // Release points are the beats the terminal copy keys off.
  assert.deepEqual(BEATS, [0.15, 0.3, 0.45, 0.58, 0.7, 0.82]);
  assert.equal(workspaceTimeline(0.44).orionNode.working, 0);
  assert.equal(workspaceTimeline(0.51).orionNode.working, 1);
  assert.equal(workspaceTimeline(0.81).vegaNode.working, 0);
  assert.equal(workspaceTimeline(0.88).vegaNode.working, 1);
  assert.equal(workspaceTimeline(0.82).packet, 0);
  assert.equal(workspaceTimeline(1).packet, 1);
  assert.equal(workspaceTimeline(0.8).packetOpacity, 0);
  assert.equal(workspaceTimeline(1).packetOpacity, 1);
});
