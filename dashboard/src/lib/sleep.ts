import fs from "node:fs";
import path from "node:path";

interface RawSleepRecord {
  date: string;
  start_at: string;
  end_at: string;
  total_sleep_time: number | null;
  total_time_in_bed?: number | null;
  sleep_efficiency?: number | null;
  deep_sleep_duration?: number | null;
  light_sleep_duration?: number | null;
  rem_sleep_duration?: number | null;
  waso?: number | null;
  wakeup_count?: number | null;
  sleep_score?: number | null;
  hr_average?: number | null;
}

export interface SleepRecord {
  date: string; // YYYY-MM-DD
  totalSleepTime: number; // 秒
  deep: number; // 秒 (欠損は 0)
  light: number;
  rem: number;
  waso: number;
  score: number | null;
  hrAverage: number | null;
  wakeupCount: number | null;
  efficiency: number | null; // 0-1
}

export interface SleepStats {
  latest: SleepRecord;
  avg7dSleepTime: number; // 秒
  deepRatioPercent: number | null; // 最新夜の深い睡眠比率 (%)
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function loadSleepData(): SleepRecord[] {
  // data.ts と同様、Astro v6 の prerender 中は process.cwd() が
  // dashboard ディレクトリを指す
  const dataPath = path.resolve(process.cwd(), "../sleep.jsonl");
  if (!fs.existsSync(dataPath)) {
    return [];
  }
  const raw = fs.readFileSync(dataPath, "utf-8").trim();
  if (raw === "") {
    return [];
  }

  const records = raw
    .split("\n")
    .map((line: string) => JSON.parse(line) as RawSleepRecord)
    .filter((r: RawSleepRecord) => r.total_sleep_time != null);

  // 同一日に複数レコード (昼寝など) がある場合はメイン睡眠 = 最長を採用
  const byDate = new Map<string, RawSleepRecord>();
  for (const r of records) {
    const existing = byDate.get(r.date);
    if (
      existing == null ||
      (r.total_sleep_time ?? 0) > (existing.total_sleep_time ?? 0)
    ) {
      byDate.set(r.date, r);
    }
  }

  return Array.from(byDate.values())
    .map((r) => ({
      date: r.date,
      totalSleepTime: r.total_sleep_time!,
      deep: r.deep_sleep_duration ?? 0,
      light: r.light_sleep_duration ?? 0,
      rem: r.rem_sleep_duration ?? 0,
      waso: r.waso ?? 0,
      score: r.sleep_score ?? null,
      hrAverage: r.hr_average ?? null,
      wakeupCount: r.wakeup_count ?? null,
      efficiency: r.sleep_efficiency ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function calcSleepStats(data: SleepRecord[]): SleepStats | null {
  if (data.length === 0) return null;

  const latest = data[data.length - 1];

  // 直近7日 (日付基準) に記録がある夜の平均
  const cutoff = new Date(latest.date);
  cutoff.setDate(cutoff.getDate() - 6);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const recent = data.filter((r) => r.date >= cutoffStr);
  const avg7dSleepTime =
    recent.reduce((sum, r) => sum + r.totalSleepTime, 0) / recent.length;

  const deepRatioPercent =
    latest.deep > 0 && latest.totalSleepTime > 0
      ? Math.round((latest.deep / latest.totalSleepTime) * 100)
      : null;

  return { latest, avg7dSleepTime, deepRatioPercent };
}
