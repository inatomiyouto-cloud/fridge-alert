import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";

type Category = "肉・魚" | "野菜" | "調味料" | "その他";

type FoodItem = {
  id: string;
  name: string;
  expiryDate: string;
  category: Category;
};

function getStorageKey(): string {
  const userId = process.env.MY_LINE_USER_ID ?? "default";
  return `fridge-items:${userId}`;
}

function isKvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function GET() {
  if (!isKvConfigured()) {
    return NextResponse.json({ items: null, synced: false });
  }

  try {
    const items = await kv.get<FoodItem[]>(getStorageKey());
    return NextResponse.json({ items: items ?? [], synced: true });
  } catch (error) {
    console.error("Failed to load items from KV:", error);
    return NextResponse.json(
      { error: "食材データの取得に失敗しました" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  if (!isKvConfigured()) {
    return NextResponse.json({ synced: false });
  }

  try {
    const body = (await request.json()) as { items?: FoodItem[] };
    const items = body.items;

    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: "不正なデータ形式です" },
        { status: 400 }
      );
    }

    await kv.set(getStorageKey(), items);
    return NextResponse.json({ success: true, synced: true });
  } catch (error) {
    console.error("Failed to save items to KV:", error);
    return NextResponse.json(
      { error: "食材データの保存に失敗しました" },
      { status: 500 }
    );
  }
}
