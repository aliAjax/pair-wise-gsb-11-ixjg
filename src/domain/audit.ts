// 稽核规则层：班次、路线、跳过申请、补检、更正链的领域规则
// 全部为纯函数，不依赖界面与存储，便于独立测试与替换

import { SHIFT_NAMES, pointsOfArea } from "../data/points";

export type StopStatus = "pending" | "done" | "skipped" | "cancelled";

export const STOP_STATUS_LABEL: Record<StopStatus, string> = {
  pending: "待检",
  done: "已检",
  skipped: "漏检",
  cancelled: "取消",
};

export interface Shift {
  id: string;
  /** 日期，格式 YYYY-MM-DD */
  date: string;
  /** 班次名称，如 早班 */
  name: string;
}

export interface RouteStop {
  pointId: string;
  order: number;
  status: StopStatus;
  arrivedAt: string | null;
  cancelNote: string | null;
}

/** 越序确认记录：尝试越序时拦截并留痕 */
export interface Violation {
  id: string;
  /** 被越序确认的点位 */
  pointId: string;
  /** 当时应到场的点位 */
  expectedPointId: string;
  attemptedAt: string;
}

export interface Route {
  id: string;
  shiftId: string;
  area: string;
  inspector: string;
  status: "active" | "closed";
  stops: RouteStop[];
  violations: Violation[];
  createdAt: string;
  closedAt: string | null;
}

export interface SkipRequest {
  id: string;
  routeId: string;
  shiftId: string;
  area: string;
  pointId: string;
  reason: string;
  makeupShiftId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
}

export interface MakeupTask {
  id: string;
  requestId: string;
  pointId: string;
  area: string;
  /** 来源（漏检发生的）路线 */
  fromRouteId: string;
  /** 指定的补检班次 */
  shiftId: string;
  status: "open" | "done";
  doneAt: string | null;
  doneInRouteId: string | null;
}

/** 更正记录：已结班路线冻结，更正只追加不改原记录，prevId 串成更正链 */
export interface Correction {
  id: string;
  routeId: string;
  pointId: string;
  from: StopStatus;
  to: StopStatus;
  reason: string;
  prevId: string | null;
  createdAt: string;
}

// ---------- 班次工具 ----------

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function makeShiftId(date: string, name: string): string {
  return `S-${date}-${name}`;
}

export function shiftLabel(shift: Shift): string {
  return `${shift.date} ${shift.name}`;
}

export function sortShifts(shifts: Shift[]): Shift[] {
  return [...shifts].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return SHIFT_NAMES.indexOf(a.name) - SHIFT_NAMES.indexOf(b.name);
  });
}

/** a 是否晚于 b（先比日期，再比班次先后） */
export function isLaterShift(a: Shift, b: Shift): boolean {
  if (a.date !== b.date) return a.date > b.date;
  return SHIFT_NAMES.indexOf(a.name) > SHIFT_NAMES.indexOf(b.name);
}

// ---------- 路线生成 ----------

/** 按点位顺序生成路线停靠点 */
export function buildStops(area: string): RouteStop[] {
  return pointsOfArea(area).map((point) => ({
    pointId: point.id,
    order: point.order,
    status: "pending",
    arrivedAt: null,
    cancelNote: null,
  }));
}

/** 同一班次同一区域只能有一条有效（进行中）路线 */
export function activeRouteExists(routes: Route[], shiftId: string, area: string): boolean {
  return routes.some((r) => r.shiftId === shiftId && r.area === area && r.status === "active");
}

/** 当前应到场确认的点位（顺序最靠前的待检点） */
export function nextPendingStop(route: Route): RouteStop | null {
  const pending = route.stops
    .filter((s) => s.status === "pending")
    .sort((a, b) => a.order - b.order);
  return pending[0] ?? null;
}

export function pendingRequestFor(
  requests: SkipRequest[],
  routeId: string,
  pointId: string
): SkipRequest | undefined {
  return requests.find(
    (r) => r.routeId === routeId && r.pointId === pointId && r.status === "pending"
  );
}

// ---------- 到场确认（不得越序） ----------

export type ConfirmResult =
  | { kind: "confirmed"; route: Route }
  | { kind: "violation"; route: Route; error: string }
  | { kind: "error"; error: string };

export function confirmArrival(
  route: Route,
  requests: SkipRequest[],
  pointId: string,
  now: string
): ConfirmResult {
  if (route.status !== "active") {
    return { kind: "error", error: "路线已结班冻结，不能再确认" };
  }
  const stop = route.stops.find((s) => s.pointId === pointId);
  if (!stop) return { kind: "error", error: "点位不在路线中" };
  if (stop.status !== "pending") return { kind: "error", error: "该点位已处理" };
  if (pendingRequestFor(requests, route.id, pointId)) {
    return { kind: "error", error: "该点位跳过申请待核准，核准前不能确认" };
  }
  const expected = nextPendingStop(route);
  if (!expected || expected.pointId !== pointId) {
    const violation: Violation = {
      id: crypto.randomUUID(),
      pointId,
      expectedPointId: expected?.pointId ?? "",
      attemptedAt: now,
    };
    return {
      kind: "violation",
      route: { ...route, violations: [...route.violations, violation] },
      error: "越序确认被拦截：须按点位顺序到场，本次越序已记录",
    };
  }
  return {
    kind: "confirmed",
    route: {
      ...route,
      stops: route.stops.map((s) =>
        s.pointId === pointId ? { ...s, status: "done", arrivedAt: now } : s
      ),
    },
  };
}

// ---------- 跳过申请（漏检） ----------

export type RuleResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function requestSkip(
  route: Route,
  requests: SkipRequest[],
  shifts: Shift[],
  pointId: string,
  reason: string,
  makeupShiftId: string,
  now: string
): RuleResult<SkipRequest> {
  if (route.status !== "active") return { ok: false, error: "路线已结班冻结" };
  const stop = route.stops.find((s) => s.pointId === pointId);
  if (!stop || stop.status !== "pending") {
    return { ok: false, error: "仅待检点位可申请跳过" };
  }
  if (pendingRequestFor(requests, route.id, pointId)) {
    return { ok: false, error: "该点位已有待核准的跳过申请" };
  }
  if (!reason) return { ok: false, error: "申请跳过须选择原因" };
  const makeupShift = shifts.find((s) => s.id === makeupShiftId);
  if (!makeupShift) return { ok: false, error: "申请跳过须指定补检班次" };
  const currentShift = shifts.find((s) => s.id === route.shiftId);
  if (currentShift && !isLaterShift(makeupShift, currentShift)) {
    return { ok: false, error: "补检班次须晚于当前班次" };
  }
  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      routeId: route.id,
      shiftId: route.shiftId,
      area: route.area,
      pointId,
      reason,
      makeupShiftId,
      status: "pending",
      createdAt: now,
      decidedAt: null,
    },
  };
}

export interface DecideSkipOutcome {
  request: SkipRequest;
  route: Route;
  makeup: MakeupTask | null;
}

/** 核准：点位记为漏检并生成补检任务；驳回：点位恢复待检 */
export function decideSkip(
  request: SkipRequest,
  route: Route,
  approve: boolean,
  now: string
): DecideSkipOutcome {
  const decided: SkipRequest = {
    ...request,
    status: approve ? "approved" : "rejected",
    decidedAt: now,
  };
  if (!approve) return { request: decided, route, makeup: null };
  const nextRoute: Route = {
    ...route,
    stops: route.stops.map((s) =>
      s.pointId === request.pointId ? { ...s, status: "skipped" } : s
    ),
  };
  const makeup: MakeupTask = {
    id: crypto.randomUUID(),
    requestId: request.id,
    pointId: request.pointId,
    area: request.area,
    fromRouteId: route.id,
    shiftId: request.makeupShiftId,
    status: "open",
    doneAt: null,
    doneInRouteId: null,
  };
  return { request: decided, route: nextRoute, makeup };
}

// ---------- 取消点位 ----------

export function cancelStop(
  route: Route,
  requests: SkipRequest[],
  pointId: string,
  note: string
): RuleResult<Route> {
  if (route.status !== "active") return { ok: false, error: "路线已结班冻结" };
  const stop = route.stops.find((s) => s.pointId === pointId);
  if (!stop || stop.status !== "pending") {
    return { ok: false, error: "仅待检点位可取消" };
  }
  if (pendingRequestFor(requests, route.id, pointId)) {
    return { ok: false, error: "该点位跳过申请待核准，请先处理申请" };
  }
  if (!note.trim()) return { ok: false, error: "取消点位须填写原因" };
  return {
    ok: true,
    value: {
      ...route,
      stops: route.stops.map((s) =>
        s.pointId === pointId ? { ...s, status: "cancelled", cancelNote: note.trim() } : s
      ),
    },
  };
}

// ---------- 结班 ----------

export function closeRoute(
  route: Route,
  requests: SkipRequest[],
  now: string
): RuleResult<Route> {
  if (route.status !== "active") return { ok: false, error: "路线已结班" };
  const pendingReqs = requests.filter((r) => r.routeId === route.id && r.status === "pending");
  if (pendingReqs.length > 0) {
    return { ok: false, error: `还有 ${pendingReqs.length} 条跳过申请未经核准，不能结班` };
  }
  const pendingStops = route.stops.filter((s) => s.status === "pending");
  if (pendingStops.length > 0) {
    return { ok: false, error: `还有 ${pendingStops.length} 个点位未处理，不能结班` };
  }
  return { ok: true, value: { ...route, status: "closed", closedAt: now } };
}

/** 结班小结：漏检、越序、取消点位 */
export function closeSummary(route: Route) {
  return {
    missed: route.stops.filter((s) => s.status === "skipped"),
    cancelled: route.stops.filter((s) => s.status === "cancelled"),
    violations: route.violations,
  };
}

// ---------- 补检 ----------

export function confirmMakeup(
  makeup: MakeupTask,
  routes: Route[],
  now: string
): RuleResult<MakeupTask> {
  if (makeup.status !== "open") return { ok: false, error: "该补检任务已完成" };
  const route = routes.find(
    (r) => r.shiftId === makeup.shiftId && r.area === makeup.area && r.status === "active"
  );
  if (!route) {
    return { ok: false, error: "补检班次在该区域暂无进行中的路线，请先生成路线" };
  }
  return {
    ok: true,
    value: { ...makeup, status: "done", doneAt: now, doneInRouteId: route.id },
  };
}

// ---------- 更正链（已结班路线冻结） ----------

/** 某点位在某路线上的更正链，按时间先后排列 */
export function correctionsFor(
  corrections: Correction[],
  routeId: string,
  pointId: string
): Correction[] {
  return corrections
    .filter((c) => c.routeId === routeId && c.pointId === pointId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 当前有效状态：原记录被冻结，取更正链末端；无更正则取原记录 */
export function effectiveStatus(stop: RouteStop, chain: Correction[]): StopStatus {
  return chain.length > 0 ? chain[chain.length - 1].to : stop.status;
}

export function correctStop(
  route: Route,
  corrections: Correction[],
  pointId: string,
  to: StopStatus,
  reason: string,
  now: string
): RuleResult<Correction> {
  if (route.status !== "closed") {
    return { ok: false, error: "仅已结班路线可登记更正" };
  }
  const stop = route.stops.find((s) => s.pointId === pointId);
  if (!stop) return { ok: false, error: "点位不在路线中" };
  if (!reason.trim()) return { ok: false, error: "更正须填写原因" };
  const chain = correctionsFor(corrections, route.id, pointId);
  const from = effectiveStatus(stop, chain);
  if (to === from) return { ok: false, error: "更正状态与当前有效状态相同" };
  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      routeId: route.id,
      pointId,
      from,
      to,
      reason: reason.trim(),
      prevId: chain.length > 0 ? chain[chain.length - 1].id : null,
      createdAt: now,
    },
  };
}
