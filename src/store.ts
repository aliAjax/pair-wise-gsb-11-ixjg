// 状态层：Zustand + localStorage 持久化。
// 所有变更都经过 domain/audit 的规则函数，刷新后班次、路线、补检、更正链保持一致。

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CheckResult,
  Correction,
  MakeupTask,
  Route,
  closeShift,
  confirmArrival,
  correctPoint,
  createRoute as createRouteRule,
  decideSkip,
  cancelPoint,
  dateStr,
  requestSkip,
  shiftKeyOf
} from "./domain/audit";

export const STORAGE_KEY = "dfwlfront-10-audit";

interface AuditState {
  routes: Route[];
  makeups: MakeupTask[];
  corrections: Correction[];
  createRoute: (input: { shiftKey: string; regionId: string; inspector: string }) => string | null;
  confirm: (routeId: string, pointId: string, result: CheckResult, note: string) => string | null;
  applySkip: (routeId: string, pointId: string, reason: string, makeupShiftKey: string) => string | null;
  decideSkip: (routeId: string, pointId: string, approve: boolean) => void;
  cancelPoint: (routeId: string, pointId: string, reason: string) => string | null;
  closeRoute: (routeId: string) => string | null;
  correct: (routeId: string, pointId: string, field: "result" | "note", to: string, reason: string) => string | null;
  completeMakeup: (taskId: string) => void;
}

const now = () => new Date().toISOString();
const makeId = () => crypto.randomUUID();

// 种子数据：用规则函数跑一遍完整流程，保证首屏就能看到
// 已结班路线（含漏检/越序/取消小结）、补检任务和更正链。
function buildSeed(): { routes: Route[]; makeups: MakeupTask[]; corrections: Correction[] } {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const yDate = dateStr(yesterday);
  const at = (day: Date, h: number, m: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString();

  // 路线一：昨日早班 加油区，已结班（含漏检、越序、取消）
  const created = createRouteRule([], {
    id: "seed-route-fuel",
    shiftKey: shiftKeyOf(yDate, "morning"),
    regionId: "fuel",
    inspector: "何鑫",
    now: at(yesterday, 6, 0)
  });
  let route = created.route!;
  route = confirmArrival(route, "fuel-01", "normal", "运行平稳", at(yesterday, 6, 10)).route;
  // 越序尝试：跳过 2 号直接确认 3 号，被规则拦下并记录
  route = confirmArrival(route, "fuel-03", "normal", "", at(yesterday, 6, 12)).route;
  route = confirmArrival(route, "fuel-02", "abnormal", "2号枪漏油痕迹", at(yesterday, 6, 15)).route;
  route = requestSkip(route, "fuel-03", "检修中", shiftKeyOf(yDate, "middle"), at(yesterday, 6, 20)).route;
  route = decideSkip(route, "fuel-03", true, at(yesterday, 6, 30)).route;
  route = cancelPoint(route, "fuel-04", "急停按钮面板更换中，维保单位驻场", at(yesterday, 6, 35)).route;
  const closed = closeShift(route, at(yesterday, 6, 50), () => "seed-makeup-1");
  route = closed.route;

  // 路线二：今日早班 收银区，进行中
  const created2 = createRouteRule([route], {
    id: "seed-route-shop",
    shiftKey: shiftKeyOf(dateStr(today), "morning"),
    regionId: "shop",
    inspector: "王莉",
    now: at(today, 6, 5)
  });
  let route2 = created2.route!;
  route2 = confirmArrival(route2, "shop-01", "normal", "压力正常", at(today, 6, 20)).route;

  const correction = correctPoint(route, {
    id: "seed-correction-1",
    pointId: "fuel-02",
    field: "note",
    to: "2号枪漏油痕迹，已报维修工单 WO-1001",
    reason: "补充维修工单号",
    now: at(yesterday, 9, 10)
  });

  return {
    routes: [route2, route],
    makeups: closed.makeups ?? [],
    corrections: correction.correction ? [correction.correction] : []
  };
}

const seed = buildSeed();

export const useAuditStore = create<AuditState>()(
  persist(
    (set, get) => ({
      routes: seed.routes,
      makeups: seed.makeups,
      corrections: seed.corrections,

      createRoute: (input) => {
        const result = createRouteRule(get().routes, { ...input, id: makeId(), now: now() });
        if (!result.ok || !result.route) return result.error ?? "创建失败";
        set((state) => ({ routes: [result.route!, ...state.routes] }));
        return null;
      },

      confirm: (routeId, pointId, result, note) => {
        const route = get().routes.find((item) => item.id === routeId);
        if (!route) return "路线不存在";
        const outcome = confirmArrival(route, pointId, result, note, now());
        set((state) => ({
          routes: state.routes.map((item) => (item.id === routeId ? outcome.route : item))
        }));
        return outcome.ok ? null : outcome.error ?? "确认失败";
      },

      applySkip: (routeId, pointId, reason, makeupShiftKey) => {
        const route = get().routes.find((item) => item.id === routeId);
        if (!route) return "路线不存在";
        const outcome = requestSkip(route, pointId, reason, makeupShiftKey, now());
        set((state) => ({
          routes: state.routes.map((item) => (item.id === routeId ? outcome.route : item))
        }));
        return outcome.ok ? null : outcome.error ?? "申请失败";
      },

      decideSkip: (routeId, pointId, approve) => {
        const route = get().routes.find((item) => item.id === routeId);
        if (!route) return;
        const outcome = decideSkip(route, pointId, approve, now());
        set((state) => ({
          routes: state.routes.map((item) => (item.id === routeId ? outcome.route : item))
        }));
      },

      cancelPoint: (routeId, pointId, reason) => {
        const route = get().routes.find((item) => item.id === routeId);
        if (!route) return "路线不存在";
        const outcome = cancelPoint(route, pointId, reason, now());
        set((state) => ({
          routes: state.routes.map((item) => (item.id === routeId ? outcome.route : item))
        }));
        return outcome.ok ? null : outcome.error ?? "取消失败";
      },

      closeRoute: (routeId) => {
        const route = get().routes.find((item) => item.id === routeId);
        if (!route) return "路线不存在";
        const outcome = closeShift(route, now(), makeId);
        if (!outcome.ok) return outcome.error ?? "不能结班";
        set((state) => ({
          routes: state.routes.map((item) => (item.id === routeId ? outcome.route : item)),
          makeups: [...state.makeups, ...(outcome.makeups ?? [])]
        }));
        return null;
      },

      correct: (routeId, pointId, field, to, reason) => {
        const route = get().routes.find((item) => item.id === routeId);
        if (!route) return "路线不存在";
        const outcome = correctPoint(route, { id: makeId(), pointId, field, to, reason, now: now() });
        if (!outcome.ok || !outcome.correction) return outcome.error ?? "更正失败";
        set((state) => ({ corrections: [...state.corrections, outcome.correction!] }));
        return null;
      },

      completeMakeup: (taskId) => {
        set((state) => ({
          makeups: state.makeups.map((task) =>
            task.id === taskId ? { ...task, status: "done", doneAt: now() } : task
          )
        }));
      }
    }),
    { name: STORAGE_KEY, version: 1 }
  )
);
