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
  stage_segments?: string | null;
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
  bedOffsetH: number | null; // date の 0:00 からの相対時間 (h)。前日23:33 → -0.45
  wakeOffsetH: number | null; // 7:27 → 7.45
  bedTime: string | null; // "23:33"
  wakeTime: string | null; // "07:27"
  timeInBed: number | null; // 秒
  // 夜の中のステージ区間 (date の 0:00 基準の時間)。state: 0=覚醒, 1=浅い, 2=深い, 3=REM
  stageSegments: { startH: number; endH: number; state: number }[] | null;
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

const TS_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/;

// "2026-07-08 23:33:00+09:00" を baseDate ("2026-07-09") の 0:00 起点の
// 相対時間に変換。Date のローカル TZ 変換を通さないので閲覧者の TZ に依存しない
function parseClockOffset(
  ts: string | null | undefined,
  baseDate: string,
): { offsetH: number; clock: string } | null {
  if (!ts) return null;
  const m = TS_RE.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const [by, bm, bd] = baseDate.split("-").map(Number);
  const dayDiff =
    (Date.UTC(+y, +mo - 1, +d) - Date.UTC(by, bm - 1, bd)) / 86_400_000;
  return { offsetH: dayDiff * 24 + +h + +mi / 60, clock: `${h}:${mi}` };
}

// stage_segments ([[start_at からのオフセット秒, 長さ秒, state], ...] の JSON) を
// date の 0:00 基準の時間区間に変換する。就寝〜起床の範囲にクリップし、不正は null
function parseStageSegments(
  raw: string | null | undefined,
  bedOffsetH: number | null,
  wakeOffsetH: number | null,
): { startH: number; endH: number; state: number }[] | null {
  if (!raw || bedOffsetH == null || wakeOffsetH == null) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const segs = arr
      .map(([off, dur, state]: number[]) => ({
        startH: Math.max(bedOffsetH + off / 3600, bedOffsetH),
        endH: Math.min(bedOffsetH + (off + dur) / 3600, wakeOffsetH),
        state,
      }))
      .filter((s) => s.endH > s.startH);
    return segs.length > 0 ? segs : null;
  } catch {
    return null;
  }
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
    .map((r) => {
      const bed = parseClockOffset(r.start_at, r.date);
      const wake = parseClockOffset(r.end_at, r.date);
      return {
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
        bedOffsetH: bed?.offsetH ?? null,
        wakeOffsetH: wake?.offsetH ?? null,
        bedTime: bed?.clock ?? null,
        wakeTime: wake?.clock ?? null,
        timeInBed:
          r.total_time_in_bed ??
          (bed && wake
            ? Math.round((wake.offsetH - bed.offsetH) * 3600)
            : null),
        stageSegments: parseStageSegments(
          r.stage_segments,
          bed?.offsetH ?? null,
          wake?.offsetH ?? null,
        ),
      };
    })
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
