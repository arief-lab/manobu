const CHROME_FREE_PATHS: readonly string[] = [
  "/setup",
  "/dashboard",
  "/lesson",
  "/reader",
  "/roleplay",
  "/drill",
  "/conjugate",
  "/listen",
  "/settings",
  "/kanji",
  "/review",
  "/ai",
  "/chat/history",
  "/exam",
];

export function isChromeFreePath(pathname: string): boolean {
  return (
    CHROME_FREE_PATHS.includes(pathname) ||
    pathname.startsWith("/kanji/") ||
    pathname.startsWith("/exam/")
  );
}
