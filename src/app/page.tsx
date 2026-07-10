"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Beef,
  Camera,
  CheckCircle2,
  FlaskConical,
  Leaf,
  Loader2,
  Package,
  Plus,
  Refrigerator,
  Trash2,
} from "lucide-react";

const STORAGE_KEY = "fridge-alert-items";

type Category = "肉・魚" | "野菜" | "調味料" | "その他";

type FoodItem = {
  id: string;
  name: string;
  expiryDate: string;
  category: Category;
};

const CATEGORIES: {
  value: Category;
  label: string;
  icon: typeof Beef;
  color: string;
  bg: string;
}[] = [
  { value: "肉・魚", label: "肉・魚", icon: Beef, color: "text-rose-600", bg: "bg-rose-50" },
  { value: "野菜", label: "野菜", icon: Leaf, color: "text-emerald-600", bg: "bg-emerald-50" },
  { value: "調味料", label: "調味料", icon: FlaskConical, color: "text-amber-600", bg: "bg-amber-50" },
  { value: "その他", label: "その他", icon: Package, color: "text-sky-600", bg: "bg-sky-50" },
];

function getCategoryMeta(category: Category) {
  return CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[3];
}

function daysUntilExpiry(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate + "T00:00:00");
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatExpiryLabel(days: number): string {
  if (days < 0) return `期限切れ（${Math.abs(days)}日前）`;
  if (days === 0) return "今日が期限";
  return `あと${days}日`;
}

function isUrgent(days: number): boolean {
  return days <= 0;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [items, setItems] = useState<FoodItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [showAlert, setShowAlert] = useState(false);

  const [name, setName] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [category, setCategory] = useState<Category>("その他");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const alertSentRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadItems() {
      try {
        const response = await fetch("/api/items");
        const data = (await response.json()) as {
          items?: FoodItem[] | null;
          synced?: boolean;
        };

        if (data.synced && Array.isArray(data.items)) {
          if (data.items.length > 0) {
            setItems(data.items);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data.items));
          } else {
            const raw = localStorage.getItem(STORAGE_KEY);
            const localItems = raw ? (JSON.parse(raw) as FoodItem[]) : [];
            setItems(localItems);

            if (localItems.length > 0) {
              await fetch("/api/items", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: localItems }),
              });
            }
          }
        } else {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) setItems(JSON.parse(raw) as FoodItem[]);
        }
      } catch {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) setItems(JSON.parse(raw) as FoodItem[]);
        } catch {
          setItems([]);
        }
      }
      setHydrated(true);
    }

    loadItems();
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));

    const timer = setTimeout(() => {
      fetch("/api/items", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      }).catch((error) => {
        console.error("Failed to sync items:", error);
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [items, hydrated]);

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
      ),
    [items]
  );

  const urgentCount = useMemo(
    () => items.filter((item) => isUrgent(daysUntilExpiry(item.expiryDate))).length,
    [items]
  );

  useEffect(() => {
    if (hydrated && urgentCount > 0) setShowAlert(true);
  }, [hydrated, urgentCount]);

  useEffect(() => {
    if (!hydrated || !showAlert || urgentCount === 0 || alertSentRef.current) return;

    alertSentRef.current = true;

    const urgentItems = items
      .filter((item) => isUrgent(daysUntilExpiry(item.expiryDate)))
      .map((item) => ({
        name: item.name,
        days: daysUntilExpiry(item.expiryDate),
      }));

    fetch("/api/send-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: urgentItems }),
    }).catch((error) => {
      console.error("Failed to send LINE alert:", error);
    });
  }, [hydrated, showAlert, urgentCount, items]);

  const addItem = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !expiryDate) return;

      const newItem: FoodItem = {
        id: crypto.randomUUID(),
        name: name.trim(),
        expiryDate,
        category,
      };

      setItems((prev) => [...prev, newItem]);
      setName("");
      setExpiryDate("");
      setCategory("その他");
    },
    [name, expiryDate, category]
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const consumeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleImageSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      setIsAnalyzing(true);
      setAnalyzeError(null);

      try {
        const image = await fileToBase64(file);
        const response = await fetch("/api/analyze-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image, mimeType: file.type }),
        });

        const data = (await response.json()) as {
          items?: { name: string; expiryDate: string; category: Category }[];
          error?: string;
        };

        if (!response.ok || !data.items?.length) {
          throw new Error(data.error ?? "画像の解析に失敗しました");
        }

        if (data.items.length === 1) {
          const item = data.items[0];
          setName(item.name);
          setExpiryDate(item.expiryDate);
          setCategory(item.category);
        } else {
          setItems((prev) => [
            ...prev,
            ...data.items!.map((item) => ({
              id: crypto.randomUUID(),
              name: item.name,
              expiryDate: item.expiryDate,
              category: item.category,
            })),
          ]);
        }
      } catch (error) {
        setAnalyzeError(
          error instanceof Error ? error.message : "画像の解析に失敗しました"
        );
      } finally {
        setIsAnalyzing(false);
      }
    },
    []
  );

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-50 via-white to-emerald-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50">
      {/* Alert Modal */}
      {showAlert && urgentCount > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="alert-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <h2 id="alert-title" className="text-lg font-bold text-gray-900">
                  期限が近い食材が{urgentCount}件あります！
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  今日が期限、またはすでに期限切れの食材があります。早めに確認してください。
                </p>
              </div>
            </div>
            <ul className="mb-5 max-h-40 space-y-2 overflow-y-auto">
              {sortedItems
                .filter((item) => isUrgent(daysUntilExpiry(item.expiryDate)))
                .map((item) => {
                  const days = daysUntilExpiry(item.expiryDate);
                  const meta = getCategoryMeta(item.category);
                  const Icon = meta.icon;
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm"
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                      <span className="flex-1 font-medium text-gray-800">
                        {item.name}
                      </span>
                      <span className="font-semibold text-red-600">
                        {formatExpiryLabel(days)}
                      </span>
                    </li>
                  );
                })}
            </ul>
            <button
              onClick={() => setShowAlert(false)}
              className="w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
            >
              確認しました
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Header */}
        <header className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center justify-center rounded-2xl bg-sky-100 p-3">
            <Refrigerator className="h-8 w-8 text-sky-600" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            冷蔵庫の残り物賞味期限アラート
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            食材の賞味期限を管理して、無駄なく消費しましょう
          </p>
          {items.length > 0 && (
            <p className="mt-3 inline-block rounded-full bg-white px-4 py-1 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-gray-100">
              登録中 {items.length} 件
              {urgentCount > 0 && (
                <span className="ml-2 text-red-600">
                  ・要確認 {urgentCount} 件
                </span>
              )}
            </p>
          )}
        </header>

        {/* Add Form */}
        <section className="mb-8 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-800">
            <Plus className="h-5 w-5 text-sky-600" />
            食材を登録
          </h2>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleImageSelect}
            disabled={isAnalyzing}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isAnalyzing}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sky-200 bg-sky-50/50 px-4 py-3 text-sm font-semibold text-sky-700 transition-all hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                AIが解析中...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4" />
                📸 写真から自動入力
              </>
            )}
          </button>
          {analyzeError && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {analyzeError}
            </p>
          )}

          <form onSubmit={addItem} className="space-y-4">
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
                食材名
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：鶏むね肉、にんじん"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
                required
              />
            </div>

            <div>
              <label htmlFor="expiry" className="mb-1 block text-sm font-medium text-gray-700">
                賞味期限
              </label>
              <input
                id="expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
                required
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">カテゴリー</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CATEGORIES.map(({ value, label, icon: Icon, color, bg }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-xs font-medium transition-all ${
                      category === value
                        ? "border-sky-500 bg-sky-50 shadow-sm"
                        : "border-transparent bg-gray-50 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full ${bg}`}>
                      <Icon className={`h-5 w-5 ${color}`} />
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              登録する
            </button>
          </form>
        </section>

        {/* Item List */}
        <section>
          <h2 className="mb-4 text-base font-semibold text-gray-800">
            食材一覧
            <span className="ml-2 text-sm font-normal text-gray-400">
              （賞味期限が近い順）
            </span>
          </h2>

          {sortedItems.length === 0 ? (
            <div className="rounded-2xl bg-white py-16 text-center shadow-sm ring-1 ring-gray-100">
              <Refrigerator className="mx-auto mb-3 h-12 w-12 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">
                まだ食材が登録されていません
              </p>
              <p className="mt-1 text-xs text-gray-400">
                上のフォームから食材を追加してください
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {sortedItems.map((item) => {
                const days = daysUntilExpiry(item.expiryDate);
                const urgent = isUrgent(days);
                const meta = getCategoryMeta(item.category);
                const Icon = meta.icon;

                return (
                  <li
                    key={item.id}
                    className={`rounded-2xl bg-white p-4 shadow-sm ring-1 transition-all sm:p-5 ${
                      urgent ? "ring-red-200" : "ring-gray-100"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${meta.bg}`}
                      >
                        <Icon className={`h-5 w-5 ${meta.color}`} />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-semibold text-gray-900">
                              {item.name}
                            </h3>
                            <p className="mt-0.5 text-xs text-gray-400">
                              {item.category} ・ {item.expiryDate}
                            </p>
                          </div>
                          <button
                            onClick={() => removeItem(item.id)}
                            aria-label={`${item.name}を削除`}
                            className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${
                              urgent
                                ? "bg-red-100 text-red-600"
                                : days <= 3
                                  ? "bg-orange-100 text-orange-600"
                                  : "bg-emerald-100 text-emerald-600"
                            }`}
                          >
                            {formatExpiryLabel(days)}
                          </span>

                          <button
                            onClick={() => consumeItem(item.id)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            消費完了
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <footer className="mt-10 pb-6 text-center text-xs text-gray-400">
          データはクラウドに保存され、PC・スマホで共有されます
        </footer>
      </div>
    </div>
  );
}
