import http from "node:http";

const port = Number(process.env.PORT ?? 8787);
const endpoint = "https://leetcode.com/graphql";
const cache = new Map();

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
        lang
        langSlug
        code
      }
    }
  }
`;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname !== "/api/problems") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const skip = Math.max(0, Number(url.searchParams.get("skip") ?? 0));
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") ?? 6)));
    const cacheKey = `${skip}:${limit}`;

    if (cache.has(cacheKey)) {
      sendJson(response, 200, cache.get(cacheKey));
      return;
    }

    const list = await leetcodeGraphql(listQuery, {
      categorySlug: "",
      skip,
      limit,
      filters: null
    });

    const result = list.data.problemsetQuestionListV2;
    const items = await Promise.all(
      result.questions.map(async (question) => {
        const detail = await leetcodeGraphql(detailQuery, {
          titleSlug: question.titleSlug
        });
        const questionDetail = detail.data.question;
        const python = questionDetail?.codeSnippets?.find(
          (snippet) => snippet.langSlug === "python3"
        );

        return {
          id: Number(question.questionFrontendId),
          title: question.title,
          difficulty: normalizeDifficulty(question.difficulty),
          slug: question.titleSlug,
          prompt: question.paidOnly
            ? "This is a LeetCode premium problem. Open it on LeetCode to view the full prompt."
            : htmlToText(questionDetail?.content ?? ""),
          bullets: bulletsFromTags(question.topicTags),
          solution: "",
          starterCode: normalizeStarterCode(python?.code),
          hasSolution: false,
          source: "leetcode"
        };
      })
    );

    const page = {
      cursor: skip,
      nextCursor: skip + limit >= result.totalLength ? null : skip + limit,
      items
    };

    cache.set(cacheKey, page);
    sendJson(response, 200, page);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Unable to fetch LeetCode data"
    });
  }
});

server.listen(port, () => {
  console.log(`LeetFlash API listening on http://localhost:${port}`);
});

async function leetcodeGraphql(query, variables) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: "https://leetcode.com/problemset/",
      "User-Agent": "LeetFlash/1.0"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`LeetCode GraphQL returned ${response.status}`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }

  return json;
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function bulletsFromTags(tags = []) {
  if (tags.length === 0) {
    return [
      "Identify the input shape and expected output.",
      "Choose the simplest data structure that preserves needed state.",
      "Walk through edge cases before coding."
    ];
  }

  return tags.slice(0, 3).map((tag) => `Look for a ${tag.name} pattern.`);
}

function normalizeStarterCode(code) {
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

function normalizeDifficulty(difficulty) {
  const lower = String(difficulty ?? "").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function htmlToText(html) {
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
