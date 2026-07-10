import { LineBotClient } from "@line/bot-sdk";
import { NextResponse } from "next/server";

type AlertItem = {
  name: string;
  days: number;
};

function formatLineStatus(days: number): string {
  if (days < 0) return "期限切れ";
  return `あと${days}日`;
}

function buildMessage(items: AlertItem[]): string {
  const lines = items.map(
    (item) => `・${item.name} (${formatLineStatus(item.days)})`
  );
  return `【冷蔵庫アラート】期限が近い食材があります！\n${lines.join("\n")}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { items?: AlertItem[] };
    const items = body.items;

    if (!items?.length) {
      return NextResponse.json(
        { error: "通知する食材がありません" },
        { status: 400 }
      );
    }

    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    const userId = process.env.MY_LINE_USER_ID;

    if (!channelAccessToken || !channelSecret || !userId) {
      return NextResponse.json(
        { error: "LINE の環境変数が設定されていません" },
        { status: 500 }
      );
    }

    const client = LineBotClient.fromChannelAccessToken({
      channelAccessToken,
    });

    await client.pushMessage({
      to: userId,
      messages: [
        {
          type: "text",
          text: buildMessage(items),
        },
      ],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to send LINE alert:", error);
    return NextResponse.json(
      { error: "LINE 通知の送信に失敗しました" },
      { status: 500 }
    );
  }
}
