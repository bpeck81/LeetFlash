import { createClient } from "npm:@supabase/supabase-js@2.49.1";

type GenerateRequest = {
  question: {
    id: number;
    slug: string;
    title: string;
    difficulty: "Easy" | "Medium" | "Hard";
    prompt: string;
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
    if (existing.data?.solution && existing.data.approach?.length) {
      return json({ solution: existing.data });
    }

    await supabase.from("question_solutions").upsert(
      {
        question_id: question.id,
        slug: question.slug,
        title: question.title,
        difficulty: question.difficulty,
        prompt: question.prompt,
        starter_code: question.starterCode ?? "class Solution:\n    pass"
      },
      { onConflict: "question_id" }
    );

    const generated = await generateWithOpenAI(openaiKey, model, question);
    const saved = await supabase
      .from("question_solutions")
      .upsert(
        {
          question_id: question.id,
          slug: question.slug,
          title: question.title,
          difficulty: question.difficulty,
          prompt: question.prompt,
          starter_code: question.starterCode ?? "class Solution:\n    pass",
          approach: generated.approach,
          solution: generated.solution,
          generated_by: model,
          generated_at: new Date().toISOString()
        },
        { onConflict: "question_id" }
      )
      .select("*")
      .single();

    if (saved.error) throw saved.error;

    return json({ solution: saved.data });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unable to generate solution"
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
        "You write concise LeetCode study cards. Return only valid JSON matching the schema. The solution must be Python 3 in LeetCode class Solution style. Keep approach bullets short and actionable.",
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

Prompt:
${question.prompt}`
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
              approach: {
                type: "array",
                minItems: 3,
                maxItems: 5,
                items: { type: "string" }
              },
              solution: { type: "string" }
            },
            required: ["approach", "solution"]
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
  const parsed = JSON.parse(text) as { approach: string[]; solution: string };

  return {
    approach: parsed.approach,
    solution: parsed.solution
  };
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
