/**
 * POST /api/narrative — generates a diagnostic memo using DeepSeek API (OpenAI-compatible).
 * Body: full ScorecardResult JSON. Streams the model response back.
 * Set DEEPSEEK_API_KEY in .env.local (Next.js loads it automatically).
 */
export async function POST(req: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "DEEPSEEK_API_KEY is not set. Add it to .env.local to enable AI diagnosis." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const scorecard = await req.json();

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: `You are writing a concise operational diagnostic memo for the owner or managing partner of an accounting firm.

Use the structured analysis provided to explain:
- Current book quality
- Main operational risks
- Where manual effort is being lost
- What kind of value Quanto could create for this firm
- Why that value matters given the firm's score profile

Important:
- If the firm is strong (grade A), emphasize preserving quality at scale, standardizing workflows, protecting margins, and faster onboarding.
- If the firm is middling (B or C), emphasize team leverage, process consistency, and reducing recurring operational friction.
- If the firm is weak (D), emphasize cleanup, risk reduction, and better operational visibility.

Keep the memo concise, sharp, and credible. Use specific numbers from the data. Avoid generic AI fluff and avoid sounding like marketing copy. Write in short prose paragraphs. Do not use markdown or asterisks (no ** for bold).`,
        },
        {
          role: "user",
          content: `Structured analysis for ${scorecard.firmName} (grade: ${scorecard.overallGrade}):\n\n${JSON.stringify(scorecard, null, 2)}\n\nWrite a concise operational diagnostic memo (4–5 short paragraphs) that explains book quality, operational risks, where manual effort is lost, what value Quanto could create, and why it matters for this grade profile.`,
        },
      ],
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(
      JSON.stringify({ error: `DeepSeek API error: ${res.status} ${err}` }),
      { status: res.status, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const json = JSON.parse(line.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (typeof content === "string") controller.enqueue(encoder.encode(content));
              } catch {
                // skip malformed chunks
              }
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
