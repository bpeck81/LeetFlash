import { createClient } from "npm:@supabase/supabase-js@2.49.1";

type GenerateRequest = {
  question: {
    id: number;
    slug: string;
    title: string;
    difficulty: "Easy" | "Medium" | "Hard";
    prompt: string;
    examples?: string;
    constraints?: string;
    starterCode?: string;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await request.json()) as GenerateRequest;
    const question = body.question;

    if (!question?.id || !question.slug || !question.title || !question.prompt) {
      return json({ error: "Missing question payload" }, 400);
    }

    const supabaseUrl = mustGetEnv("SUPABASE_URL");
    const serviceRoleKey = mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");
    const openaiKey = mustGetEnv("OPENAI_API_KEY");
    const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini";

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const existing = await supabase
      .from("question_solutions")
      .select("*")
      .eq("question_id", question.id)
      .maybeSingle();

    if (existing.error) throw existing.error;
    if (
      existing.data?.prompt &&
      existing.data?.examples &&
      existing.data?.constraints_text &&
      existing.data?.solution &&
      existing.data?.approach?.length
    ) {
      return json({ solution: existing.data });
    }

    const generated = normalizeGeneratedCard(
      await generateWithOpenAI(openaiKey, model, question),
      question
    );
    if (!isCompleteGeneratedCard(generated)) {
      throw new Error("OpenAI returned an incomplete study card");
    }
    const generatedCard = {
      question_id: question.id,
      slug: question.slug,
      title: question.title,
      difficulty: question.difficulty,
      prompt: generated.prompt,
      examples: generated.examples,
      constraints_text: generated.constraints,
      starter_code: question.starterCode ?? "class Solution:\n    pass",
      approach: generated.approach,
      solution: generated.solution,
      generated_by: model,
      generated_at: new Date().toISOString()
    };

    const saved = await supabase
      .from("question_solutions")
      .upsert(generatedCard, { onConflict: "question_id" })
      .select("*")
      .single();

    if (saved.error) throw saved.error;

    return json({ solution: saved.data });
  } catch (error) {
    return json(
      {
        error: describeError(error)
      },
      500
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

function mustGetEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Unable to generate solution";
  }
}

function isCompleteGeneratedCard(card: {
  prompt?: string;
  examples?: string;
  constraints?: string;
  approach?: string[];
  solution?: string;
}) {
  return Boolean(
    isUsefulText(card.prompt) &&
      isUsefulText(card.examples) &&
      isUsefulText(card.constraints) &&
      card.approach?.length &&
      isUsefulText(card.solution)
  );
}

function normalizeGeneratedCard(
  card: {
    prompt: string;
    examples: string;
    constraints: string;
    approach: string[];
    solution: string;
  },
  question: GenerateRequest["question"]
) {
  return {
    ...card,
    prompt: isUsefulText(card.prompt)
      ? card.prompt
      : `Original practice problem based on "${question.title}". Write a Python solution matching the provided starter signature.`,
    examples: isUsefulText(card.examples)
      ? card.examples
      : `Example 1: Use a small representative input for ${question.title} and produce the expected output. Example 2: Include an edge case such as an empty, single-node, or minimal input when applicable.`,
    constraints: isUsefulText(card.constraints)
      ? card.constraints
      : "Use the provided function signature. Preserve the required output behavior. Aim for efficient time complexity and avoid mutating immutable inputs."
  };
}

function isUsefulText(value?: string) {
  if (!value?.trim()) return false;
  const lower = value.toLowerCase();

  return ![
    "not provided",
    "examples are not loaded",
    "constraints are not loaded",
    "getting"
  ].some((phrase) => lower.includes(phrase));
}

async function generateWithOpenAI(
  apiKey: string,
  model: string,
  question: GenerateRequest["question"]
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions:
        "You write complete coding interview study cards. Return only valid JSON matching the schema. Always fill prompt, examples, constraints, approach, and solution with useful original content. Never return placeholders like 'not provided', 'no examples', or 'open LeetCode'. The solution must be Python 3 in LeetCode class Solution style. Preserve type annotations only in the LeetCode method signature if they are present in the starter code. Do not add type annotations to helper functions, local variables, temporary variables, nested functions, or return types beyond the main provided signature. Include concise, useful comments in the code for key algorithm steps, but do not comment every line. Keep approach bullets short and actionable. If the original prompt is unavailable or premium-gated, create an original practice problem based on the title and common interview interpretation; do not claim it is the original premium text.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Problem: #${question.id} ${question.title}
Difficulty: ${question.difficulty}
Starter code:
${question.starterCode ?? "class Solution:\n    pass"}

Known prompt:
${question.prompt}

Known examples:
${question.examples || "Not provided"}

Known constraints:
${question.constraints || "Not provided"}`
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "leetcode_solution_card",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              prompt: { type: "string" },
              examples: { type: "string" },
              constraints: { type: "string" },
              approach: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: { type: "string" }
              },
              solution: { type: "string" }
            },
            required: ["prompt", "examples", "constraints", "approach", "solution"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI returned ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const text = extractOutputText(payload);
  const parsed = JSON.parse(text) as {
    prompt: string;
    examples: string;
    constraints: string;
    approach: string[];
    solution: string;
  };

  return {
    prompt: parsed.prompt,
    examples: parsed.examples,
    constraints: parsed.constraints,
    approach: parsed.approach,
    solution: stripExtraTypeAnnotations(parsed.solution)
  };
}

function stripExtraTypeAnnotations(code: string) {
  const lines = code.split("\n");
  let keptPrimarySignature = false;

  return lines
    .map((line) => {
      if (/^\s*def\s+/.test(line)) {
        if (!keptPrimarySignature && line.includes("self")) {
          keptPrimarySignature = true;
          return line;
        }

        return line
          .replace(/\s*->\s*[^:]+:/, ":")
          .replace(/\((.*)\)/, (_match, args: string) => {
            const cleaned = args
              .split(",")
              .map((arg) => arg.replace(/:\s*[^=,]+(?=\s*(=|$))/, ""))
              .join(",");
            return `(${cleaned})`;
          });
      }

      return line.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^=]+=/, "$1 =");
    })
    .join("\n");
}

function extractOutputText(payload: {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
}) {
  if (payload.output_text) return payload.output_text;

  const content = payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text" || item.text);

  if (!content?.text) throw new Error("OpenAI response did not include text output");
  return content.text;
}
