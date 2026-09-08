/** Original architectural illustrations. Product controls remain real HTML below. */
export function ChapterArtwork({ chapter }: { chapter: string }) {
  return (
    <svg
      className={`chapter-art chapter-art--${chapter}`}
      viewBox="0 0 1100 650"
      fill="none"
      aria-hidden="true"
    >
      <g className="chapter-art-grid" stroke="currentColor" opacity=".18">
        <path d="M0 540 550 210 1100 540M0 640 550 310 1100 640M130 650 550 410 970 650M330 650 550 520 770 650M550 0v650M0 210h1100" />
        <circle cx="765" cy="280" r="235" />
        <circle cx="765" cy="280" r="170" />
      </g>
      {chapter === 'workspace' && (
        <>
          <g className="chapter-art-back">
            <path d="m495 438 270-155 315 175-270 160Z" fill="#374e50" stroke="#768c84" />
            <path d="m555 390 210-120 245 138-210 123Z" fill="#bcc4b3" />
            <path d="m555 390 245 141v42L555 430Z" fill="#788d82" />
            <path d="m800 531 210-123v42L800 573Z" fill="#9bac9b" />
            <path d="M900 113v244l110 64V179Z" fill="#314b50" stroke="#738681" />
            <path d="m920 150 70 41v176l-70-41Z" stroke="#a8b5a1" />
          </g>
          <g className="chapter-art-mid" stroke="#afc2b5">
            <path d="m540 242 126-72v151l-126 74Z" fill="#14262d" />
            <path d="m553 256 97-56m-97 81 77-44m-77 71 87-50m-87 78 61-35" />
            <path d="m827 280 126 72v151l-126-73Z" fill="#14262d" />
            <path d="m843 309 92 53m-92-24 73 42m-73-14 86 50" />
          </g>
          <path
            className="chapter-art-wire"
            pathLength="1"
            d="M665 290C740 230 770 420 828 375"
            stroke="#22d3ee"
            strokeWidth="2"
          />
          <g className="chapter-art-front">
            <path d="m708 365 57-33 60 34-57 34Z" fill="#eeece2" />
            <path d="m708 365 60 35v17l-60-35Z" fill="#839d93" />
            <path d="m768 400 57-34v17l-57 34Z" fill="#bdd2b9" />
            <circle cx="766" cy="364" r="8" stroke="#45616a" />
          </g>
        </>
      )}
      {chapter === 'control' && (
        <>
          <g className="chapter-art-back" fill="#3e5151" stroke="#738881">
            <path d="m538 514 214-121 281 157-214 123Z" />
            <path
              d="M650 135 807 49l178 102v359l-47 28V180L807 105l-112 62v345l-45-24Z"
              fill="#9ca995"
            />
            <path d="m695 167 112-62v49l-68 39v345l-44-26Z" fill="#526960" />
            <path d="m807 49 178 102-47 29-131-75Z" fill="#d4d8c3" />
          </g>
          <g className="chapter-art-mid">
            <path d="M744 220v259l139 79V298Z" fill="#203339" stroke="#f0b458" strokeWidth="2" />
            <path
              d="m771 303 46-10 43 55v62c0 36-21 48-43 50-25-28-46-65-46-97Z"
              stroke="#f0b458"
              strokeWidth="2"
            />
            <path d="m802 366 14 22 24-16" stroke="#f0b458" strokeWidth="3" />
          </g>
          <path
            className="chapter-art-wire"
            pathLength="1"
            d="M503 435 622 367 744 437"
            stroke="#f0b458"
            strokeWidth="2"
          />
          <g className="chapter-art-front">
            <path d="m566 375 44-26 45 26-44 27Z" fill="#eeece2" />
            <path d="m566 375 45 27v26l-45-27Z" fill="#8f9c8a" />
            <path d="m611 402 44-27v26l-44 27Z" fill="#b8c4a7" />
          </g>
        </>
      )}
      {chapter === 'identity' && (
        <>
          <g className="chapter-art-back" stroke="#768477">
            <circle cx="790" cy="315" r="178" />
            <ellipse cx="790" cy="315" rx="178" ry="63" transform="rotate(-32 790 315)" />
            <path d="m552 478 229-130 261 146-228 133Z" fill="#b1bbaa" />
            <path d="m552 478 262 149v27L552 504Z" fill="#8e9f8d" />
          </g>
          <g className="chapter-art-mid">
            <path d="m663 194 164-90 137 78v269l-164 95-137-79Z" fill="#e8e9da" stroke="#768477" />
            <path d="m827 104 137 78-164 94-137-82Z" fill="#f8f5ec" />
            <path d="m800 276 164-94v269l-164 95Z" fill="#c6cfb9" />
            <path d="m690 284 79 45m-79-15 60 35m-60-4 79 45m-79-13 43 25" stroke="#6b7f71" />
            <path d="m866 302 34-20 34 20v40l-34 20-34-20Z" stroke="#596d60" strokeWidth="2" />
          </g>
          <path
            className="chapter-art-wire"
            pathLength="1"
            d="M557 343C670 420 753 495 900 363"
            stroke="#536b60"
            strokeWidth="2"
          />
          <g className="chapter-art-front">
            <circle cx="557" cy="343" r="30" fill="#eeece2" stroke="#6b7f71" />
            <circle cx="557" cy="334" r="8" stroke="#6b7f71" />
            <path d="M542 358c0-18 30-18 30 0" stroke="#6b7f71" />
          </g>
        </>
      )}
    </svg>
  );
}

export function TaskConstellation() {
  const items = [
    ['01', 'Define the scope', 'coordinator'],
    ['02', 'Build the API', 'Orion / backend'],
    ['03', 'Create checkout', 'Vega / frontend'],
    ['04', 'Share the schema', 'payment-api.json'],
    ['05', 'Review the change', 'human owner'],
  ];
  return (
    <div className="task-constellation" data-scroll-visual>
      <div className="constellation-heading">
        <span className="eyebrow">FROM SEPARATE SESSIONS TO SHARED INTENT</span>
        <h3>
          Let the work
          <br />
          <em>find its shape.</em>
        </h3>
        <p>
          Bounded tasks. Named owners.
          <br />
          One dependency at a time.
        </p>
      </div>
      <div className="constellation-field" aria-label="Illustrative task coordination sequence">
        <svg viewBox="0 0 700 450" preserveAspectRatio="none" aria-hidden="true">
          <path
            className="constellation-wire"
            pathLength="1"
            d="M110 90 350 75 550 160 380 285 150 345M110 90 380 285M350 75 150 345"
          />
        </svg>
        {items.map(([number, title, owner], index) => (
          <div className={`constellation-task constellation-task-${index}`} key={number}>
            <span>
              {number} / {owner}
            </span>
            <strong>{title}</strong>
            <small>
              {index === 3
                ? '{ } versioned artifact'
                : index === 4
                  ? '◇ approval checkpoint'
                  : '↳ illustrative task'}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}
