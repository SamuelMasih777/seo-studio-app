/**
 * Google Gemini (Generative Language API) for product description copy.
 * Env: GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_AI_API_KEY).
 * Optional: GEMINI_MODEL (default gemini-2.5-flash-lite).
 */

export type ContentLengthOption = "short" | "medium" | "long";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Models Google has retired for new API keys - map to a current default. */
const DEPRECATED_MODEL_PATTERNS =
  /2\.0-flash-lite|gemini-2\.0-flash-lite|gemini-1\.0|gemini-pro\b/i;

export function resolveGeminiModelId(): string {
  let m = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  if (m.startsWith("models/")) {
    m = m.slice("models/".length);
  }
  if (!m || DEPRECATED_MODEL_PATTERNS.test(m)) {
    return DEFAULT_MODEL;
  }
  return m;
}

export function getGeminiApiKey(): string | undefined {
  const k =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_AI_API_KEY?.trim();
  return k || undefined;
}

export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}

function lengthGuidance(length: ContentLengthOption): string {
  switch (length) {
    case "short":
      return "About 2–3 short paragraphs, roughly 60–100 words total.";
    case "long":
      return "About 4–6 paragraphs, roughly 200–320 words total.";
    default:
      return "About 3–4 paragraphs, roughly 120–180 words total.";
  }
}

function buildUserPrompt(input: {
  productTitle: string;
  targetKeyword: string;
  tone: string;
  length: ContentLengthOption;
  audienceHint?: string;
  originalDescriptionPlain?: string;
}): string {
  const parts = [
    `Write a compelling e-commerce product description for Shopify.`,
    ``,
    `Product title: ${input.productTitle}`,
    `Primary SEO keyword to weave in naturally (do not stuff): ${input.targetKeyword}`,
    `Tone: ${input.tone}`,
    `Length: ${lengthGuidance(input.length)}`,
  ];
  if (input.audienceHint?.trim()) {
    parts.push(`Target audience / notes: ${input.audienceHint.trim()}`);
  }
  if (input.originalDescriptionPlain?.trim()) {
    parts.push(
      ``,
      `Existing description (rewrite and improve; do not copy verbatim):`,
      input.originalDescriptionPlain.trim().slice(0, 8000),
    );
  }
  parts.push(
    ``,
    `Output rules:`,
    `- Plain text only (no HTML, no markdown).`,
    `- Separate paragraphs with a single blank line.`,
    `- Do not include headings like "Description:" or bullet labels unless they fit the tone.`,
    `- No placeholder text like [brand] or Lorem ipsum.`,
  );
  return parts.join("\n");
}

type GeminiErrorBody = {
  error?: { message?: string; code?: number; status?: string };
};

function extractTextFromResponse(data: unknown): string | null {
  const d = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  if (d.promptFeedback?.blockReason) {
    return null;
  }
  const text = d.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("");
  const trimmed = text?.trim();
  return trimmed || null;
}

export async function generateProductDescriptionPlain(input: {
  productTitle: string;
  targetKeyword: string;
  tone: string;
  length: ContentLengthOption;
  audienceHint?: string;
  originalDescriptionPlain?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "AI content generation is not configured. Ask the app developer to set the API key.",
    };
  }

  const model = resolveGeminiModelId();
  const url = `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildUserPrompt(input) }],
      },
    ],
    generationConfig: {
      temperature: 0.75,
      maxOutputTokens: 2048,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "The AI content request failed. Please try again.",
    };
  }

  const raw = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: `Unexpected response while generating AI content (${res.status}).`,
    };
  }

  if (!res.ok) {
    const msg = (json as GeminiErrorBody).error?.message || raw.slice(0, 200);
    return {
      ok: false,
      error: `AI generation failed (${res.status}): ${msg}`,
    };
  }

  const text = extractTextFromResponse(json);
  if (!text) {
    return {
      ok: false,
      error:
        "No AI-generated description was returned (content may have been blocked). Try a different tone or shorten the input.",
    };
  }

  return { ok: true, text };
}

function buildImageAltPrompt(input: {
  productTitle: string;
  existingAlt?: string;
}): string {
  const parts = [
    `Write one concise alt text for a product photo on a Shopify storefront.`,
    `Product: ${input.productTitle}`,
  ];
  if (input.existingAlt?.trim()) {
    parts.push(`Current alt (improve or replace if weak): ${input.existingAlt.trim().slice(0, 200)}`);
  }
  parts.push(
    ``,
    `Output rules:`,
    `- Plain text only: a single line, no quotes, no markdown.`,
    `- Max 125 characters. Be specific and useful for screen readers.`,
    `- Describe what the image likely shows for this product; avoid "image of" or "photo of" if the rest is clear.`,
    `- No HTML, no emojis, no promotional fluff.`,
  );
  return parts.join("\n");
}

/** Short, accessibility-focused alt text from product context (no image vision). */
export async function generateProductImageAltPlain(input: {
  productTitle: string;
  existingAlt?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error:
        "AI content generation is not configured. Ask the app developer to set the API key.",
    };
  }

  const model = resolveGeminiModelId();
  const url = `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: buildImageAltPrompt(input) }],
      },
    ],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 256,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "The AI content request failed. Please try again.",
    };
  }

  const raw = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: `Unexpected response while generating AI content (${res.status}).`,
    };
  }

  if (!res.ok) {
    const msg = (json as GeminiErrorBody).error?.message || raw.slice(0, 200);
    return {
      ok: false,
      error: `AI generation failed (${res.status}): ${msg}`,
    };
  }

  const text = extractTextFromResponse(json);
  if (!text) {
    return {
      ok: false,
      error:
        "No AI-generated alt text was returned (content may have been blocked). Try again or use a pattern instead.",
    };
  }

  const oneLine = text.replace(/\s+/g, " ").trim().slice(0, 512);
  return { ok: true, text: oneLine };
}

/** Convert plain text with blank-line paragraphs into simple safe HTML for Shopify descriptionHtml. */
export function plainTextProductDescriptionToHtml(plain: string): string {
  const chunks = plain
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (chunks.length === 0) return "<p></p>";
  return chunks
    .map((c) => {
      const escaped = c
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br />");
      return `<p>${escaped}</p>`;
    })
    .join("");
}
