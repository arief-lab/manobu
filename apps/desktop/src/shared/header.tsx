import { Link } from "@tanstack/react-router";

export default function Header() {
  // The bento surfaces are chrome-free (own ← bars); this Header only
  // renders on the routes that never joined the family (/jlpt-mock,
  // dev, the conversation surface — /ai left it in TASK-79.2 and carries
  // its own ← desk pill; /review joined the family in TASK-170 with its
  // own ← desk). "AI Chat" is its single link: the
  // sidebar that once carried more is gone (router audit 2026-09-14
  // retired AppShell with the /learn layout), and Home would be a link
  // to the page you redirect through anyway.
  const links = [{ label: "AI Chat", to: "/ai" }] as const;

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.map(({ to, label }) => (
            <Link key={to} to={to}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <hr />
    </div>
  );
}
