type LeetCodeQuestion = {
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  paidOnly: boolean;
  topicTags: Array<{ name: string; slug: string }>;
};

const endpoint = "https://leetcode.com/graphql";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

const listQuery = `
  query problemsetQuestionList(
    $categorySlug: String
    $limit: Int
    $skip: Int
    $filters: QuestionFilterInput
  ) {
    problemsetQuestionListV2(
      categorySlug: $categorySlug
      limit: $limit
      skip: $skip
      filters: $filters
    ) {
      totalLength
      questions {
        questionFrontendId
        title
        titleSlug
        difficulty
        paidOnly
        topicTags {
          name
          slug
        }
      }
    }
  }
`;

const detailQuery = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      content
      codeSnippets {
        langSlug
        code
      }
    }
  }
`;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const skip = Math.max(0, Number(url.searchParams.get("skip") ?? 0));
    const limit = Math.min(10, Math.max(1, Number(url.searchParams.get("limit") ?? 1)));

    const list = await leetcodeGraphql(listQuery, {
      categorySlug: "",
      skip,
      limit,
      filters: null
    });

    const result = list.data.problemsetQuestionListV2;
    const items = await Promise.all(
      result.questions.map(async (question: LeetCodeQuestion) => {
        const detail = await leetcodeGraphql(detailQuery, {
          titleSlug: question.titleSlug
        });
        const python = detail.data.question?.codeSnippets?.find(
          (snippet: { langSlug: string }) => snippet.langSlug === "python3"
        );

        return {
          id: Number(question.questionFrontendId),
          title: question.title,
          difficulty: normalizeDifficulty(question.difficulty),
          slug: question.titleSlug,
          prompt: question.paidOnly
            ? "This is a LeetCode premium problem. Generate an original study-card version based on the title."
            : htmlToText(detail.data.question?.content ?? ""),
          bullets: bulletsFromTags(question.topicTags),
          solution: "",
          starterCode: normalizeStarterCode(python?.code),
          hasSolution: false,
          source: "leetcode"
        };
      })
    );

    return json({
      cursor: skip,
      nextCursor: skip + limit >= result.totalLength ? null : skip + limit,
      items
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unable to fetch problems"
      },
      502
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function leetcodeGraphql(query: string, variables: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: "https://leetcode.com/problemset/",
      "User-Agent": "LeetFlash/1.0"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) throw new Error(`LeetCode GraphQL returned ${response.status}`);

  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json;
}

function bulletsFromTags(tags: Array<{ name: string }> = []) {
  if (tags.length === 0) {
    return [
      "Identify the input shape and expected output.",
      "Choose the simplest data structure that preserves needed state.",
      "Walk through edge cases before coding."
    ];
  }

  return tags.slice(0, 3).map((tag) => `Look for a ${tag.name} pattern.`);
}

function normalizeStarterCode(code?: string) {
  if (!code) return "class Solution:\n    pass";

  const lines = code.split("\n");
  const classIndex = lines.findIndex((line) => line.trim().startsWith("class Solution"));
  const signatureIndex = lines.findIndex((line, index) => {
    return index > classIndex && line.trim().startsWith("def ");
  });

  if (classIndex >= 0 && signatureIndex >= 0) {
    return `${lines[classIndex]}\n${lines[signatureIndex]}`;
  }

  return "class Solution:\n    pass";
}

function normalizeDifficulty(difficulty: string) {
  const lower = String(difficulty ?? "").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function htmlToText(html: string) {
  return html
    .replace(/<pre>/gi, "\n")
    .replace(/<\/pre>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
