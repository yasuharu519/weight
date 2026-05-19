import type { APIRoute } from "astro";
import { loadData } from "../lib/data";

// ビルド時に dist/latest.json を生成する静的エンドポイント。
// GitHub Pages 上の https://yasuharu519.github.io/weight/latest.json として配信され、
// README の shields.io dynamic badge がこれを参照する。
export const GET: APIRoute = () => {
  const records = loadData(); // date 昇順ソート済み（src/lib/data.ts）
  const latest = records[records.length - 1];
  return new Response(
    JSON.stringify({
      date: latest.date,
      weight: latest.weight,
      fatPercent: latest.fatPercent,
    }),
    { headers: { "content-type": "application/json" } },
  );
};
