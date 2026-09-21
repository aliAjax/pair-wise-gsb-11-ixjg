// 稽核规则层：路线生成、到场确认顺序、跳过核准、结班小结、更正链。
// 全部为纯函数，不依赖 React / localStorage，方便单测与替换存储。

import { pointsOfRegion, shiftDefs } from "../data/points";

export type PointStatus = "pending" | "checked" | "skipped" | "cancelled";
export type CheckResult = "normal" | "abnormal";
export type RouteStatus = "active" | "closed";

export interface SkipRequest {
  reason: string;
  makeupShiftKey: string;
  requestedAt: string;
  approved: boolean;
  decidedAt: string | null;
}

export interface RoutePoint {
  pointId: string;
  order: number;
  status: PointStatus;
  result: CheckResult | null;
  note: string;
  checkedAt: string | null;
  skipRequest: SkipRequest | null;
  cancelReason: string | null;
}

export interface Violation {
  pointId: string;
  expectedPointId: string | null;
  attemptedAt: string;
}

export interface CloseSummary {
  missed: string[];
  outOfOrder: string[];
  cancelled: string[];
}

export interface Route {
  id: string;
  shiftKey: string;
  regionId: string;
  inspector: string;
  status: RouteStatus;
  points: RoutePoint[];
  violations: Violation[];
  createdAt: string;
  closedAt: string | null;
  summary: CloseSummary | null;
}

export interface MakeupTask {
  id: string;
  routeId: string;
  pointId: string;
  shiftKey: string;
  reason: string;
  status: "pending" | "done";
  createdAt: string;
  doneAt: string | null;
}

export interface Correction {
  id: string;
  routeId: string;
  pointId: string;
  field: "result" | "note";
  from: string;
  to: string;
  reason: string;
  createdAt: string;
}

export interface RuleOutcome {
  ok: boolean;
  error?: string;
  route: Route;
  makeups?: MakeupTask[];
}

// ---------- 班次 ----------

export function dateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayStr(): string {
  return dateStr(new Date());
}

export function shiftKeyOf(date: string, shiftId: string): string {
  return `${date}|${shiftId}`;
}

export function parseShiftKey(key: string): { date: string; shiftId: string } {
  const [date, shiftId] = key.split("|");
  return { date, shiftId };
}

export function shiftLabel(key: string): string {
  const { date, shiftId } = parseShiftKey(key);
  const def = shiftDefs.find((item) => item.id === shiftId);
  return def ? `${date} ${def.name}` : key;
}

export function compareShiftKeys(a: string, b: string): number {
  const pa = parseShiftKey(a);
  const pb = parseShiftKey(b);
  if (pa.date !== pb.date) return pa.date < pb.date ? -1 : 1;
  const ia = shiftDefs.findIndex((item) => item.id === pa.shiftId);
  const ib = shiftDefs.findIndex((item) => item.id === pb.shiftId);
  return ia - ib;
}

export function nextShiftKey(key: string): string {
  const { date, shiftId } = parseShiftKey(key);
  const index = shiftDefs.findIndex((item) => item.id === shiftId);
  if (index >= 0 && index < shiftDefs.length - 1) {
    return shiftKeyOf(date, shiftDefs[index + 1].id);
  }
  const [y, m, d] = date.split("-").map(Number);
  return shiftKeyOf(dateStr(new Date(y, m - 1, d + 1)), shiftDefs[0].id);
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

// ---------- 路线生成 ----------

export function buildRoutePoints(regionId: string): RoutePoint[] {
  return pointsOfRegion(regionId).map((point) => ({
    pointId: point.id,
    order: point.order,
    status: "pending",
    result: null,
    note: "",
    checkedAt: null,
    skipRequest: null,
    cancelReason: null
  }));
}

export function hasActiveRoute(routes: Route[], shiftKey: string, regionId: string): boolean {
  return routes.some(
    (route) => route.shiftKey === shiftKey && route.regionId === regionId && route.status === "active"
  );
}

export function createRoute(
  existing: Route[],
  input: { id: string; shiftKey: string; regionId: string; inspector: string; now: string }
): { ok: boolean; error?: string; route?: Route } {
  if (!input.inspector.trim()) return { ok: false, error: "请选择巡检人" };
  if (hasActiveRoute(existing, input.shiftKey, input.regionId)) {
    return { ok: false, error: "同一班次同一区域只能有一条有效路线" };
  }
  const points = buildRoutePoints(input.regionId);
  if (points.length === 0) return { ok: false, error: "该区域未配置点位" };
  return {
    ok: true,
    route: {
      id: input.id,
      shiftKey: input.shiftKey,
      regionId: input.regionId,
      inspector: input.inspector.trim(),
      status: "active",
      points,
      violations: [],
      createdAt: input.now,
      closedAt: null,
      summary: null
    }
  };
}

// ---------- 到场确认（不可越序） ----------

export function nextPendingPoint(route: Route): RoutePoint | null {
  return route.points.find((point) => point.status === "pending") ?? null;
}

function replacePoint(route: Route, pointId: string, patch: Partial<RoutePoint>): Route {
  return {
    ...route,
    points: route.points.map((point) => (point.pointId === pointId ? { ...point, ...patch } : point))
  };
}

export function confirmArrival(
  route: Route,
  pointId: string,
  result: CheckResult,
  note: string,
  now: string
): RuleOutcome {
  if (route.status !== "active") return { ok: false, error: "路线已结班冻结，只能走更正流程", route };
  const target = route.points.find((point) => point.pointId === pointId);
  if (!target) return { ok: false, error: "点位不在路线中", route };
  if (target.status !== "pending") return { ok: false, error: "该点位已处理", route };
  const next = nextPendingPoint(route);
  if (next && next.pointId !== pointId) {
    // 越序确认：记录违规尝试，状态不变
    const violated: Route = {
      ...route,
      violations: [...route.violations, { pointId, expectedPointId: next.pointId, attemptedAt: now }]
    };
    return { ok: false, error: "到场确认不能越序，已记录违规尝试", route: violated };
  }
  return {
    ok: true,
    route: replacePoint(route, pointId, {
      status: "checked",
      result,
      note: note.trim(),
      checkedAt: now,
      skipRequest: null
    })
  };
}

// ---------- 跳过申请与核准 ----------

export function requestSkip(
  route: Route,
  pointId: string,
  reason: string,
  makeupShiftKey: string,
  now: string
): RuleOutcome {
  if (route.status !== "active") return { ok: false, error: "路线已结班冻结", route };
  const target = route.points.find((point) => point.pointId === pointId);
  if (!target) return { ok: false, error: "点位不在路线中", route };
  if (target.status !== "pending") return { ok: false, error: "该点位已处理", route };
  if (target.skipRequest) return { ok: false, error: "该点位已有待核准的跳过申请", route };
  if (!reason.trim()) return { ok: false, error: "跳过必须选择原因", route };
  if (!makeupShiftKey) return { ok: false, error: "跳过必须指定补检班次", route };
  if (makeupShiftKey === route.shiftKey) return { ok: false, error: "补检班次不能是当前班次", route };
  if (compareShiftKeys(makeupShiftKey, route.shiftKey) < 0) {
    return { ok: false, error: "补检班次不能早于当前班次", route };
  }
  return {
    ok: true,
    route: replacePoint(route, pointId, {
      skipRequest: {
        reason: reason.trim(),
        makeupShiftKey,
        requestedAt: now,
        approved: false,
        decidedAt: null
      }
    })
  };
}

export function decideSkip(route: Route, pointId: string, approve: boolean, now: string): RuleOutcome {
  if (route.status !== "active") return { ok: false, error: "路线已结班冻结", route };
  const target = route.points.find((point) => point.pointId === pointId);
  if (!target?.skipRequest) return { ok: false, error: "该点位没有待核准的跳过申请", route };
  if (target.skipRequest.approved) return { ok: false, error: "申请已核准", route };
  if (!approve) {
    // 驳回：申请作废，点位回到待检
    return { ok: true, route: replacePoint(route, pointId, { skipRequest: null }) };
  }
  return {
    ok: true,
    route: replacePoint(route, pointId, {
      status: "skipped",
      skipRequest: { ...target.skipRequest, approved: true, decidedAt: now }
    })
  };
}

// ---------- 取消点位 ----------

export function cancelPoint(route: Route, pointId: string, reason: string, now: string): RuleOutcome {
  if (route.status !== "active") return { ok: false, error: "路线已结班冻结", route };
  const target = route.points.find((point) => point.pointId === pointId);
  if (!target) return { ok: false, error: "点位不在路线中", route };
  if (target.status !== "pending") return { ok: false, error: "该点位已处理", route };
  if (target.skipRequest) return { ok: false, error: "请先驳回待核准的跳过申请", route };
  if (!reason.trim()) return { ok: false, error: "取消必须填写原因", route };
  void now;
  return {
    ok: true,
    route: replacePoint(route, pointId, { status: "cancelled", cancelReason: reason.trim() })
  };
}

// ---------- 结班 ----------

export function closeBlockers(route: Route): string[] {
  if (route.status !== "active") return [];
  const blockers: string[] = [];
  const pending = route.points.filter((point) => point.status === "pending" && !point.skipRequest);
  if (pending.length > 0) blockers.push(`${pending.length} 个点位未处理`);
  const awaiting = route.points.filter((point) => point.skipRequest && !point.skipRequest.approved);
  if (awaiting.length > 0) blockers.push(`${awaiting.length} 个跳过申请未经核准`);
  return blockers;
}

export function closeShift(route: Route, now: string, makeId: () => string): RuleOutcome {
  if (route.status !== "active") return { ok: false, error: "路线已结班", route };
  const blockers = closeBlockers(route);
  if (blockers.length > 0) return { ok: false, error: `不能结班：${blockers.join("；")}`, route };
  const summary: CloseSummary = {
    missed: route.points.filter((point) => point.status === "skipped").map((point) => point.pointId),
    outOfOrder: [...new Set(route.violations.map((item) => item.pointId))],
    cancelled: route.points.filter((point) => point.status === "cancelled").map((point) => point.pointId)
  };
  const makeups: MakeupTask[] = route.points
    .filter((point) => point.status === "skipped" && point.skipRequest)
    .map((point) => ({
      id: makeId(),
      routeId: route.id,
      pointId: point.pointId,
      shiftKey: point.skipRequest!.makeupShiftKey,
      reason: point.skipRequest!.reason,
      status: "pending",
      createdAt: now,
      doneAt: null
    }));
  return {
    ok: true,
    route: { ...route, status: "closed", closedAt: now, summary },
    makeups
  };
}

// ---------- 更正（已结班路线冻结，更正另存） ----------

export function correctPoint(
  route: Route,
  input: { id: string; pointId: string; field: "result" | "note"; to: string; reason: string; now: string }
): { ok: boolean; error?: string; correction?: Correction } {
  if (route.status !== "closed") return { ok: false, error: "未结班的路线可直接修改，无需更正" };
  const target = route.points.find((point) => point.pointId === input.pointId);
  if (!target) return { ok: false, error: "点位不在路线中" };
  if (!input.reason.trim()) return { ok: false, error: "更正必须填写原因" };
  const from = input.field === "result" ? target.result ?? "" : target.note;
  const to = input.to.trim();
  if (!to) return { ok: false, error: "更正内容不能为空" };
  if (from === to) return { ok: false, error: "更正内容与原记录一致" };
  return {
    ok: true,
    correction: {
      id: input.id,
      routeId: route.id,
      pointId: input.pointId,
      field: input.field,
      from,
      to,
      reason: input.reason.trim(),
      createdAt: input.now
    }
  };
}

// 已结班点位的有效值 = 原记录 + 更正链依次覆盖（原记录本身不变）
export function effectivePoint(
  point: RoutePoint,
  corrections: Correction[]
): { result: CheckResult | null; note: string; corrected: boolean } {
  let result = point.result;
  let note = point.note;
  const related = corrections
    .filter((item) => item.pointId === point.pointId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const item of related) {
    if (item.field === "result") result = item.to as CheckResult;
    else note = item.to;
  }
  return { result, note, corrected: related.length > 0 };
}
