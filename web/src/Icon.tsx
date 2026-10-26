const paths = {
  external: "M7 17 17 7M7 7h10v10",
  reset: "M3 10a9 9 0 1 1 2 9M3 4v6h6",
  refresh: "M20 7A9 9 0 0 0 5 5L2 8M2 2v6h6M4 17a9 9 0 0 0 15 2l3-3M16 16h6v6",
  send: "M22 2 9 15M22 2l-7 20-6-7-7-6Z",
  repair: "M14 3a6 6 0 0 0-7 8l-4 4a3.5 3.5 0 0 0 5 5l4-4a6 6 0 0 0 8-7l-4 4-5-5Z",
  replay: "M3 10a9 9 0 1 1 2 9M3 4v6h6M10 8l6 4-6 4Z",
  copy: "M9 9h11v11H9ZM15 9V4H4v11h5",
  check: "M5 12l4 4L19 6",
  success: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM7 12l3 3 7-7",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2",
  stop: "M8 2h8l6 6v8l-6 6H8l-6-6V8ZM9 9l6 6M15 9l-6 6",
  hourglass: "M6 2h12M6 22h12M7 2v5l10 10v5M17 2v5L7 17v5",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronRight: "M9 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  chevronUp: "M6 15l6-6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  login: "M14 4h6v16h-6M10 8l4 4-4 4M3 12h11",
  logout: "M10 4H4v16h6M16 8l4 4-4 4M10 12h10",
};

export type IconName = keyof typeof paths;

// Button labels carry the accessible name; these icons only reinforce the action.
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="action-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
