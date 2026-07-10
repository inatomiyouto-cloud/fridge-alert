import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const maxDuration = 30;

const PROMPT = `Analyze the attached receipt or food product image. Extract each food item with:
- name (in Japanese)
- expiryDate (YYYY-MM-DD; estimate if unclear, otherwise use 3 days from today)
- category (one of: meat_fish, vegetable, seasoning, other)

Return ONLY a JSON array with no extra text or markdown:
[{"name": "食材名", "expiryDate": "YYYY-MM-DD", "category": "meat_fish | vegetable | seasoning | other"}]`;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function sanitizeApiKey(key: string): string {
  return key.trim().replace(/^["'""''«»]+|["'""''«»]+$/g, "");
}

function assertAsciiOnly(value: string, label: string): void {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 255) {
      throw new Error(
        `${label}に無効な文字が含まれています。Vercelの環境変数を再設定してください。`
      );
    }
  }
}

const MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3-flash-preview"];
const MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("503") ||
    message.includes("429") ||
    message.includes("UNAVAILABLE") ||
    message.includes("high demand") ||
    message.includes("overloaded") ||
    message.includes("RESOURCE_EXHAUSTED")
  );
}

function isModelUnavailableError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("404") ||
    message.includes("NOT_FOUND") ||
    message.includes("no longer available")
  );
}

function toUserFriendlyError(error: unknown): string {
  const message = getErrorMessage(error);

  if (isRetryableError(error)) {
    return "AIサービスが混雑しています。少し待ってから再度お試しください。";
  }

  if (message.includes("ByteString")) {
    return "GEMINI_API_KEY に不正な文字が含まれています。Vercelの環境変数を英数字のみで再設定してください。";
  }

  return message || "画像の解析に失敗しました";
}

async function analyzeImageWithGemini(
  ai: GoogleGenAI,
  base64Data: string,
  mimeType: string
): Promise<string> {
  let lastError: unknown;

  for (const model of MODELS) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    data: base64Data,
                    mimeType,
                  },
                },
                { text: PROMPT },
              ],
            },
          ],
        });

        const text = response.text;
        if (!text) {
          throw new Error("AIから応答がありませんでした");
        }

        return text;
      } catch (error) {
        lastError = error;

        if (isModelUnavailableError(error)) {
          break;
        }

        if (isRetryableError(error) && attempt < MAX_RETRIES) {
          await sleep(1000 * (attempt + 1));
          continue;
        }

        if (isRetryableError(error)) {
          break;
        }

        throw error;
      }
    }
  }

  throw lastError;
}

function normalizeMimeType(mimeType?: string): string {
  const normalized = (mimeType || "image/jpeg").toLowerCase();
  return ALLOWED_MIME_TYPES.has(normalized) ? normalized : "image/jpeg";
}

type AiCategory = "meat_fish" | "vegetable" | "seasoning" | "other";

type AiAnalyzedItem = {
  name: string;
  expiryDate: string;
  category: AiCategory;
};

type Category = "肉・魚" | "野菜" | "調味料" | "その他";

const CATEGORY_MAP: Record<AiCategory, Category> = {
  meat_fish: "肉・魚",
  vegetable: "野菜",
  seasoning: "調味料",
  other: "その他",
};

function defaultExpiryDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  return date.toISOString().slice(0, 10);
}

function normalizeCategory(value: string): Category {
  const key = value as AiCategory;
  return CATEGORY_MAP[key] ?? "その他";
}

function normalizeExpiryDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return defaultExpiryDate();
}

type AnalyzedItem = {
  name: string;
  expiryDate: string;
  category: Category;
};

function parseJsonFromText(text: string): AnalyzedItem[] {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("AIの応答からJSONを抽出できませんでした");
  }

  const parsed = JSON.parse(jsonMatch[0]) as AiAnalyzedItem[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("食材が検出されませんでした");
  }

  return parsed
    .filter((item) => item?.name?.trim())
    .map((item) => ({
      name: item.name.trim(),
      expiryDate: normalizeExpiryDate(item.expiryDate),
      category: normalizeCategory(item.category),
    }));
}

export async function POST(request: Request) {
  try {
    const rawApiKey = process.env.GEMINI_API_KEY;
    if (!rawApiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY が設定されていません" },
        { status: 500 }
      );
    }

    const apiKey = sanitizeApiKey(rawApiKey);
    assertAsciiOnly(apiKey, "GEMINI_API_KEY");

    const body = (await request.json()) as {
      image?: string;
      mimeType?: string;
    };

    if (!body.image) {
      return NextResponse.json(
        { error: "画像データが送信されていません" },
        { status: 400 }
      );
    }

    const base64Data = body.image.includes(",")
      ? body.image.split(",")[1]
      : body.image;

    const ai = new GoogleGenAI({ apiKey });

    const text = await analyzeImageWithGemini(
      ai,
      base64Data,
      normalizeMimeType(body.mimeType)
    );

    const items = parseJsonFromText(text);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to analyze image:", error);
    const message = toUserFriendlyError(error);
    const status = isRetryableError(error) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
