/** Original vector character. Shoulder, elbow, and hand layers are independently posed. */
export type CoderRole =
  'connect' | 'typing' | 'repair' | 'review' | 'control' | 'identity' | 'audit' | 'deploy' | 'wave';
export function FlatCoder({ role = 'connect' }: { role?: CoderRole }) {
  return (
    <svg
      className={`flat-coder coder--${role}`}
      data-role={role}
      viewBox="0 0 520 600"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="260" cy="551" rx="165" ry="12" fill="#0d1117" />
      <g className="coder-chair" stroke="#232c40" strokeWidth="4">
        <rect x="182" y="209" width="156" height="219" rx="48" fill="#131e2c" />
        <path d="M260 415V533M260 521L204 547M260 521L318 547" />
        <rect x="178" y="398" width="165" height="24" rx="12" fill="#233044" />
      </g>
      <g className="coder-legs" stroke="#0a0e17" strokeWidth="3">
        <path d="M202 341H260L250 438L224 520H184L202 427Z" fill="#232c40" />
        <path d="M260 341H317L326 436L338 521H295L276 442Z" fill="#1b2537" />
        <path d="M184 514H226L227 540Q202 548 166 540L168 528Z" fill="#a78bfa" />
        <path d="M294 514H337L355 532V541H294Z" fill="#a78bfa" />
        <path d="M168 541H227M295 541H355" stroke="#e2e8f0" strokeWidth="4" />
      </g>
      <g className="coder-torso">
        <path
          d="M216 193Q260 178 303 193L325 236L315 346Q260 360 201 346L194 237Z"
          fill="#263d48"
          stroke="#3b5660"
          strokeWidth="2"
        />
        <path
          d="M216 192Q215 219 260 238Q307 218 303 192L287 180H235Z"
          fill="#182b37"
          stroke="#3b5660"
          strokeWidth="2"
        />
        <path d="M238 196L260 217L283 195" stroke="#3ddc97" strokeWidth="2" />
        <path
          d="M240 217L235 266M281 216L286 265"
          stroke="#8fa7b6"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d="M232 301Q260 314 289 301L296 331H225Z" fill="#1a303c" />
        <path
          d="M253 252L244 260L253 268M267 252L276 260L267 268"
          stroke="#3ddc97"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <g className="coder-head">
        <path d="M244 163V195Q260 207 277 192V158" fill="#c9916c" />
        <path d="M244 170Q263 187 277 173V157H244Z" fill="#a96e55" />
        <path
          d="M218 127Q216 81 260 78Q307 78 305 129L296 158Q279 181 261 181Q238 178 224 157Z"
          fill="#e3ae7f"
        />
        <path
          d="M218 135Q197 108 221 82Q235 61 263 71Q292 65 308 92Q316 117 302 138L294 113Q269 119 251 100Q243 119 225 120L226 139Z"
          fill="#171e2c"
        />
        <g className="coder-eyes">
          <g className="coder-eyes-open" fill="#232c40">
            <ellipse cx="242" cy="137" rx="3.2" ry="3.8" />
            <ellipse cx="281" cy="137" rx="3.2" ry="3.8" />
          </g>
          <path
            className="coder-eyes-closed"
            d="M238 137H246M277 137H285"
            stroke="#232c40"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        <path
          d="M261 138L257 151H264M252 164Q263 169 274 162"
          stroke="#9d674e"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <g className="coder-headphones">
          <path
            d="M210 127V108Q209 67 260 66Q310 66 311 108V131"
            stroke="#3e566a"
            strokeWidth="10"
          />
          <path d="M212 108Q215 73 260 73Q304 73 309 108" stroke="#22d3ee" strokeWidth="2" />
          <rect
            x="204"
            y="119"
            width="17"
            height="37"
            rx="8"
            fill="#142533"
            stroke="#22d3ee"
            strokeWidth="2"
          />
          <rect
            x="301"
            y="119"
            width="17"
            height="37"
            rx="8"
            fill="#142533"
            stroke="#22d3ee"
            strokeWidth="2"
          />
          <path d="M309 150Q315 174 278 172" stroke="#3e566a" strokeWidth="3" />
          <rect x="271" y="169" width="13" height="6" rx="3" fill="#22d3ee" />
        </g>
      </g>
      <g className="coder-desk" stroke="#232c40" strokeWidth="3">
        <path d="M120 351L103 547M400 351L420 547" stroke="#405464" strokeWidth="9" />
        <path d="M118 377H403" stroke="#263948" strokeWidth="6" />
        <path d="M112 327H411L430 347V360H94V347Z" fill="#223343" />
        <path d="M94 347H430" stroke="#526674" />
      </g>
      <g className="coder-laptop">
        <path d="M194 275H326L308 326H209Z" fill="#172536" stroke="#5b7184" strokeWidth="2" />
        <path d="M209 326H308L335 339H188Z" fill="#3d5265" stroke="#60768a" strokeWidth="1.5" />
        <path d="M218 328H299M208 332H313" stroke="#172536" strokeWidth="2" />
        <path
          d="M253 296L247 302L253 308M267 296L273 302L267 308"
          stroke="#22d3ee"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path d="M187 340H336" stroke="#8295a8" strokeWidth="3" strokeLinecap="round" />
      </g>
      {role === 'control' && (
        <g className="coder-control-console">
          <path d="M331 316H390L399 340H326Z" fill="#172536" stroke="#60768a" strokeWidth="2" />
          <rect x="340" y="320" width="42" height="14" rx="7" fill="#33291c" stroke="#f0b458" />
          <circle className="coder-control-light" cx="350" cy="327" r="3" fill="#f0b458" />
          <text x="358" y="330" fill="#f7d28c" fontSize="8" fontWeight="700">
            HOLD
          </text>
        </g>
      )}
      <g className="coder-arms">
        {(['left', 'right'] as const).map((side) => (
          <g key={side} className={`coder-arm coder-arm--${side}`}>
            <path
              className="coder-upper-arm"
              stroke="#263d48"
              strokeWidth="37"
              strokeLinecap="round"
            />
            <path
              className="coder-sleeve-seam"
              stroke="#3b5660"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              className="coder-forearm"
              stroke="#304c57"
              strokeWidth="29"
              strokeLinecap="round"
            />
            <g className="coder-hand" fill="#e3ae7f" stroke="#b8815f" strokeWidth="1.5">
              {side === 'right' && role === 'review' && (
                <g fill="none" stroke="#f0b458" strokeWidth="4">
                  <path d="M8 0L36 -25" />
                  <circle cx="51" cy="-42" r="25" fill="#22d3ee16" />
                  <path d="M43 -51L60 -34" stroke="#9bd6e3" strokeWidth="2" />
                </g>
              )}
              {side === 'right' && role === 'repair' && (
                <path
                  d="M12 2L43 -29Q55 -22 60 -40L49 -36L43 -44Q28 -39 35 -28L5 -1Z"
                  fill="#7d94a7"
                  stroke="#a4bbc9"
                />
              )}
              <path d="M-8 -8Q0 -12 10 -7L22 -2Q27 1 22 4L10 2L22 7Q24 11 20 12L6 7L16 14Q17 18 12 17L0 10Q-8 12 -12 5Z" />
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}

export type CoderPoint = { x: number; y: number };

/** Two-segment arm pose: curved reach, elbow stays outward, wrist follows the hand. */
/**
 * `beat` is elapsed seconds, and only the typing pose uses it: a scene that
 * runs on its own clock wants fingers that keep moving after the pose has
 * settled, rather than a rhythm read off how far the page happens to be
 * scrolled. Omit it and the rhythm is derived from `reach`, as before.
 */
export function poseCoder(
  root: SVGSVGElement,
  reach: number,
  role: CoderRole = 'connect',
  beat?: number,
): [CoderPoint, CoderPoint] {
  return (['left', 'right'] as const).map((side, i) => {
    const mirror = i ? 1 : -1;
    const shoulder = { x: 260 + mirror * 55, y: 223 };
    const hand = {
      x: 260 + mirror * (25 + reach * 151),
      y: 328 - reach * 111 - Math.sin(reach * Math.PI) * 18,
    };
    const elbow = { x: 260 + mirror * (83 + reach * 31), y: 303 - reach * 49 };
    if (role === 'typing' || role === 'audit') {
      const typing = Math.max(0, Math.min(1, (reach - 0.14) / 0.16));
      const settle = typing * typing * (3 - 2 * typing);
      // The hands alternate with a small phase offset. The envelope starts at
      // rest, then stays deliberately low so the motion reads as typing.
      const phase =
        beat === undefined ? Math.max(0, reach - 0.14) * Math.PI * 11 : beat * Math.PI * 5.2;
      const rhythm = Math.sin(phase + i * 1.08);
      hand.x = 260 + mirror * 30;
      hand.y = 324 + rhythm * 4.5 * settle;
      elbow.x = 260 + mirror * 85;
      elbow.y = 299 + rhythm * 1.2 * settle;
    } else if (role === 'repair') {
      hand.x = 260 + mirror * (30 + reach * 75);
      hand.y = 330 + reach * (i ? 92 : 20);
      elbow.x = 260 + mirror * 82;
      elbow.y = 300 + reach * 45;
    } else if (role === 'control') {
      const clock = beat ?? reach;
      const move = Math.max(0, Math.min(1, (clock - 0.56) / 0.2));
      const easedMove = move * move * (3 - 2 * move);
      const press = Math.max(0, Math.min(1, (clock - 0.8) / 0.1));
      const easedPress = press * press * (3 - 2 * press);
      if (i) {
        // The right hand leaves the keyboard, reaches for HOLD, then makes a
        // short downward press. The action is tied to the boundary locking.
        hand.x = 292 + easedMove * 62;
        hand.y = 321 - easedMove * 4 + easedPress * 10;
        elbow.x = 345 + easedMove * 8;
        elbow.y = 298 + easedMove * 5;
      } else {
        // Keep the other hand grounded on the keyboard so the developer does
        // not appear to wave or celebrate.
        hand.x = 230;
        hand.y = 323;
        elbow.x = 177;
        elbow.y = 300;
      }
    } else if (role === 'identity') {
      // Identity is created from the developer's active local session. Both
      // hands remain at the laptop while the ownership graph builds beside it.
      hand.x = 260 + mirror * 30;
      hand.y = 324;
      elbow.x = 260 + mirror * 85;
      elbow.y = 299;
    } else if (role === 'review' || role === 'wave') {
      hand.x = i ? 300 + reach * 68 : 233;
      hand.y = i ? 320 - reach * (role === 'wave' ? 173 : 106) : 323;
      elbow.x = i ? 345 : 177;
      elbow.y = i ? 298 - reach * 35 : 300;
    } else if (role === 'deploy') {
      hand.x = 260 + mirror * (60 + reach * 85);
      hand.y = 340 - reach * 226;
      elbow.x = 260 + mirror * (81 + reach * 15);
      elbow.y = 295 - reach * 95;
    }
    const arm = root.querySelector(`.coder-arm--${side}`)!;
    arm
      .querySelector('.coder-upper-arm')!
      .setAttribute('d', `M${shoulder.x} ${shoulder.y}L${elbow.x} ${elbow.y}`);
    arm
      .querySelector('.coder-sleeve-seam')!
      .setAttribute(
        'd',
        `M${shoulder.x + mirror * 9} ${shoulder.y + 4}L${elbow.x + mirror * 10} ${elbow.y - 3}`,
      );
    arm
      .querySelector('.coder-forearm')!
      .setAttribute('d', `M${elbow.x} ${elbow.y}L${hand.x} ${hand.y}`);
    const angle = (Math.atan2(hand.y - elbow.y, hand.x - elbow.x) * 180) / Math.PI;
    arm
      .querySelector('.coder-hand')!
      .setAttribute('transform', `translate(${hand.x} ${hand.y}) rotate(${angle})`);
    return hand;
  }) as [CoderPoint, CoderPoint];
}
