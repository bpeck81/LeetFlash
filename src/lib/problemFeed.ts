import { PROBLEMS, type LeetProblem } from "../data/problems";

export type ProblemPage = {
  cursor: number;
  nextCursor: number | null;
  items: LeetProblem[];
};

const PAGE_SIZE = 6;
const publicEnv = process.env as Record<string, string | undefined>;
const API_BASE =
  publicEnv["EXPO_PUBLIC_LEETFLASH_API_BASE"] ??
  "https://ijklazicwpvvrnjjbggt.supabase.co/functions/v1/leetcode-problems";

export async function fetchProblemPage(cursor = 0): Promise<ProblemPage> {
  try {
    const response = await fetch(
      `${API_BASE}/api/problems?skip=${cursor}&limit=${PAGE_SIZE}`
    );

    if (!response.ok) {
      throw new Error(`LeetCode proxy returned ${response.status}`);
    }

    const page = (await response.json()) as ProblemPage;

    return {
      ...page,
      items: page.items.map((problem) => {
        const curated = PROBLEMS.find((item) => item.slug === problem.slug);

        return {
          ...problem,
          bullets: curated?.bullets ?? problem.bullets,
          solution: curated?.solution ?? problem.solution ?? "",
          starterCode: problem.starterCode ?? curated?.starterCode,
          hasSolution: Boolean(curated?.solution),
          source: "leetcode"
        };
      })
    };
  } catch {
    return fetchLocalProblemPage(cursor);
  }
}

function fetchLocalProblemPage(cursor = 0): ProblemPage {
  const items = Array.from({ length: PAGE_SIZE }, (_, index) => {
    const problemIndex = (cursor + index) % PROBLEMS.length;
    return {
      ...PROBLEMS[problemIndex],
      hasSolution: true,
      source: "local" as const
    };
  });

  return {
    cursor,
    nextCursor: cursor + PAGE_SIZE,
    items
  };
}
