import OpenAI from "openai";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompletionParams = {
  model: string; // e.g., 'openai/gpt-4o'
  messages: ChatMessage[];
  params?: Record<string, unknown>;
};

export type OpenRouterClient = {
  complete(
    input: CompletionParams
  ): Promise<{
    text: string;
    raw: unknown;
    usage?: { input_tokens?: number; output_tokens?: number };
  }>;
};

export function createOpenRouterClient(options?: {
  timeoutMs?: number;
}): OpenRouterClient {
  const baseURL = "https://openrouter.ai/api/v1";
  const apiKey = process.env.OPENROUTER_API_KEY ?? Bun.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: options?.timeoutMs ?? 30_000,
    defaultHeaders: {
      "HTTP-Referer":
        process.env.OPENROUTER_HTTP_REFERER ??
        Bun.env.OPENROUTER_HTTP_REFERER ??
        "",
      "X-Title":
        process.env.OPENROUTER_X_TITLE ??
        Bun.env.OPENROUTER_X_TITLE ??
        "maori-benchmark",
    },
  });

  async function complete(input: CompletionParams) {
    const response = await client.chat.completions.create({
      model: input.model,
      messages: input.messages,
      temperature:
        typeof input.params?.temperature === "number"
          ? (input.params.temperature as number)
          : undefined,
      max_tokens:
        typeof input.params?.max_tokens === "number"
          ? (input.params.max_tokens as number)
          : undefined,
    } as any);

    const choice = response.choices?.[0];
    const text = choice?.message?.content ?? "";
    return { text, raw: response, usage: response.usage as any };
  }

  return { complete };
}
