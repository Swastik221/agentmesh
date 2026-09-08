# AgentMesh landing page

Visit `/landing`; `/` retains the application workspace. The page runs locally
without backend, wallet, or provider credentials.

## Sequence

`CinematicIntro` pins the original SVG coder connection and reveals the headline.
`ScrollWorkspace` follows with the single React Flow canvas. Five vector chapters
cover agents, coordination, control, identity, and developers, then FAQ and closing.
The former duplicate guided demo and painting assets are not rendered.

The Agents chapter derives its complete interaction from one damped cover
progress. The developer settles first, the two hands type with a small phase
offset, four editor lines reveal in sequence, the curved data path draws, and
the agent card crossfades from waiting to ready. A packet follows the same SVG
path and becomes a calm loop only after the sequence completes. Every element
stays mounted while scrolling in either direction. Reduced motion renders the
completed state and disables the typing, caret, and packet loops.

The Coordination chapter has its own two-person SVG scene. One continuous
chapter progress introduces Anand and Swastik with their owner-linked agents,
proposes four tasks, lets their cursors pull AM-114 and AM-115 toward the suited
agents, records both claims, sends a dependency request, and carries
`payment-api.json` from Vega to Orion. Protocol chips and seven stacked captions
remain mounted and crossfade through the sequence; reverse scrolling evaluates
the same paths backward. The prior one-person repair figure is not used in this
chapter. Reduced motion exposes the final composed state.

## Shared canvas timeline

The shared canvas plays itself. `ScrollWorkspace` starts a
`requestAnimationFrame` clock the first time the section is 35% on screen and
runs the demo once over `DEMO_SECONDS` (13s); `workspaceTimeline.ts` is
unchanged and still a pure function of that 0-1 progress and the responsive
layout.

It used to be pinned and scrubbed by scroll, which made the wheel the demo's
transport: the assembly ran at whatever pace and direction the reader scrolled,
and scrolling back up took the workspace apart again. There is no ScrollTrigger
here any more and no pin spacer — the section is an ordinary 100svh block that
the page scrolls past.

0–15% introduces cursors; 15–30% approaches and grabs Orion; 30–45% drags
Orion; 45–58% releases and claims AM-114; 58–70% approaches and grabs Vega;
70–82% drags Vega; 82–100% releases, claims AM-115, and hands the API schema
from Vega to Orion. Cursor approaches use cubic ease-out; drags use cubic
ease-in-out.

During each drag the cursor position is computed first and the controlled node
position is derived from that cursor with a fixed title-bar grip, minus a lag
proportional to how fast the pointer is travelling — nothing at both ends of the
drag and about 17 canvas units at its middle, which is what reads as the pointer
pulling the terminal rather than the two sharing one coordinate. The same value
drives a capped lean.

Captions and the two attribution pills are all mounted and stacked in one cell
so they never reflow, but they hand over **in sequence**: the outgoing line is
fully gone before the incoming one arrives. Crossfading them printed two
sentences on top of each other at every boundary, which read as doubled text
rather than as a transition.

When the demo ends the canvas is handed over: the terminals become draggable
and the board pannable and pinchable, the two illustrative pointers fade out so
they do not compete with the reader's own, the artifact chip comes to rest under
the receiving terminal, and a Replay control restarts the demo. Wheel zoom stays
off and scrolling is never captured, so the page still scrolls normally over the
top of it.

Nothing in the scene mounts, unmounts or switches on a threshold. Every beat is
a ramp at least 0.05 of the demo wide, so none can complete inside a single
frame of a slow machine. Terminal log lines and task badges are keyed on a
debounced beat (`useBeat`) so they settle once per beat, and both node
components are compared on `data`/`selected`/`dragging` only — React Flow passes
each node its absolute position, so without that the log lines would re-render
on every frame. Log lines are keyed on their block, never on their text.

The three wires are drawn by the scene rather than handed to React Flow as
edges. React Flow decides for itself whether an edge can be rendered, from node
measurements it takes asynchronously, and that decision was observed to go the
wrong way and drop all three wires for the rest of the scene. `CanvasWires`
routes them with `getSmoothStepPath` — the same function React Flow would have
used — from the positions the scene already owns.

Reduced motion shows the final layout directly without the scripted demo. All
claims and artifacts are illustrative local state.

## Chapter II — the connected workshop

Chapter II is a live canvas: it runs on its own clock, not on the reader's
scroll. `useWorkshopClock` starts a `requestAnimationFrame` loop the first time
the scene comes within 300px of the viewport, and from then on it simply keeps
running; `paintWorkshop(scene, seconds)` owns everything inside the scene, and
`paintScene` returns immediately for this role so the scroll system never
touches it.

It was previously scrubbed by scroll, which made the wheel the animation's
transport: scrolling back up un-drew the wire and faded the agent card away
again — the "agents disappear" — and any stutter in the scroll was a stutter in
the illustration. Nothing the scene establishes is taken away now.

The assembly maps elapsed seconds onto the same 0-1 the ramps were already
written against, over `INTRO_SECONDS` (5.4s), as overlapping ranges rather than
steps: settle (0–0.20), typing (0.12–0.32), four code lines staggered every
0.05 across 0.15–0.41, the wire fading in (0.30–0.42) then drawing (0.35–0.75),
the packet crossing (0.58–0.86), and the card lifting (0.62–0.82), taking its
border (0.70–0.88) and its status (0.74–0.92) before the settled traffic fades
in (0.86–1.00). Measured in the browser: wire drawn by ~3.4s with the packet in
flight, card lit by ~4.6s, fully settled by ~6.1s.

Every range is wide enough that its steepest point moves the value by well
under a fifth per frame — `soften` (smoothstep) for short ranges, `arrive`
(easeOutCubic) for entering elements, `travel` (easeInOutCubic) for the wire's
long span — and every beat opens before the one before it closes, so nothing
starts from a standstill.

After assembly the canvas stays alive rather than freezing: `poseCoder` takes
an optional `beat` in seconds, used only by the typing pose, so the hands keep
a real alternating rhythm on the scene's clock instead of one read off scroll
position; the caret blinks; a SMIL packet loops the wire; and the background
circle drifts on `--agents-drift`. None of it can switch on, because each is
revealed by a ramp or runs from page load at zero amplitude.

The card's activation is a second border rect fading in over the resting one
rather than a stroke changing colour, and the generic
`.scene-code-line:nth-child(2n)` rule is scoped away from this chapter — it
tied with the per-line rules on specificity and won by order, leaving two of
the four lines reading from an unrelated ramp.

Reduced motion paints the settled state once and never animates.

## Checks

- `pnpm --filter @agentmesh/web build`
- `pnpm --filter @agentmesh/web lint`
- `node --experimental-strip-types --test apps/web/tests/workspace-timeline.test.mjs`
- `node apps/web/tests/agents-typing.browser.mjs` (with Playwright environment variables)
- `node apps/web/tests/coordination.browser.mjs` (with Playwright environment variables)

The timeline tests cover cursor/terminal attachment and its lag across desktop,
tablet and phone layouts, release boundaries, reverse evaluation, and — sampling
400 points, finer than a wheel notch — that every published value ramps instead
of switching and that the captions always add up to exactly one visible line.

`landing-scroll.browser.mjs` adds a continuity walk: 81 slow steps through the
pinned section asserting that no element mounts or unmounts, the caption never
shifts layout, no position jumps, no opacity snaps, and both terminals travel
with the pointer holding them.

Browser checks are in `apps/web/tests/workspace-drag.browser.mjs` and
`apps/web/tests/landing-scroll.browser.mjs`. Set `PLAYWRIGHT_MODULE` to an installed
Playwright module and optionally `BROWSER_EXECUTABLE` to a Chromium executable,
with the development server running on port 5173. The focused check measures
cursor and terminal displacement, checks moving edge geometry and reverse
scrolling, verifies release-before-claim, and smoke-tests reduced motion and `/`.
