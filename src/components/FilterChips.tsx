import { useState } from "preact/hooks";

// Plain serializable post shape — never a CollectionEntry or Date instance.
// The index page pre-stringifies before passing these in.
export interface ChipPost {
  id: string;
  title: string;
  dateISO: string;
  dateDisplay: string;
  project: string;
  summary: string;
}

interface Props {
  posts: ChipPost[];
}

// This island server-renders the full chip row and the complete post list, so
// with JS disabled every post is still visible (hydration simply never
// attaches; the chips are inert). Filtering is enhancement, not a gate.
export default function FilterChips({ posts }: Props) {
  const [active, setActive] = useState<string | null>(null);

  // Chips derive from projects actually present in the posts (preserving the
  // newest-first order they appear), so empty projects get no dead chip.
  const projects: string[] = [];
  for (const p of posts) {
    if (!projects.includes(p.project)) projects.push(p.project);
  }

  const visible = active === null ? posts : posts.filter((p) => p.project === active);

  // Clicking the active chip toggles back to "all".
  const toggle = (project: string) =>
    setActive((prev) => (prev === project ? null : project));

  return (
    <div>
      <div role="group" aria-label="Filter by project">
        <button
          type="button"
          aria-pressed={active === null}
          onClick={() => setActive(null)}
        >
          all
        </button>
        {projects.map((project) => (
          <button
            key={project}
            type="button"
            aria-pressed={active === project}
            onClick={() => toggle(project)}
          >
            {project}
          </button>
        ))}
      </div>

      <ul>
        {visible.map((post) => (
          <li key={post.id}>
            <a href={`/log/${post.id}/`}>{post.title}</a>
            <time datetime={post.dateISO}>{post.dateDisplay}</time>
            <span>{post.project}</span>
            <p>{post.summary}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
