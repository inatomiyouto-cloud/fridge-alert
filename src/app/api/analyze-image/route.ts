import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

const PROMPT = `添付されたレシートまたは食材の画像から、食材の名前と賞味期限（予測でも可、不明なら3日後の日付、フォーマットはYYYY-MM-DD）を推測し、以下のJSON形式でのみ返却してください。余計な解説のテキストは一切不要です。
[{"name": "食材名", "expiryDate": "YYYY-MM-DD", "category": "meat_fish | vegetable | seasoning | other"}]`;

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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY が設定されていません" },
        { status: 500 }
      );
    }

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

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: body.mimeType || "image/jpeg",
          },
        },
        PROMPT,
      ],
    });

    const text = response.text;
    if (!text) {
      return NextResponse.json(
        { error: "AIから応答がありませんでした" },
        { status: 500 }
      );
    }

    const items = parseJsonFromText(text);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to analyze image:", error);
    const message =
      error instanceof Error ? error.message : "画像の解析に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
