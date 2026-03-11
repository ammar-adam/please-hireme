import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req: Request) {
  const scorecard = await req.json();

  const stream = client.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system:
      "You are a senior accountant with 20 years of experience reviewing firm books for acquisition. Write an honest, direct assessment in plain English. Use specific numbers from the data. Do not use bullet points. Write in prose paragraphs. Do not be overly positive — if the books are messy, say so clearly.",
    messages: [
      {
        role: "user",
        content: `Here is the full scorecard JSON for ${scorecard.firmName}:\n\n${JSON.stringify(scorecard, null, 2)}\n\nWrite exactly 4 paragraphs:\n1. Overall health of the firm's books\n2. Biggest risks with specific dollar figures\n3. What this means for valuation or acquisition price\n4. What Quanto would fix first and why`,
      },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
