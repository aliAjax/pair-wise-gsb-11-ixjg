// 状态层：把稽核规则接到应用状态上，并持久化到 localStorage
// 刷新后班次、路线、补检与更正链保持一致

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SHIFT_NAMES } from "./data/points";
import * as rules from "./domain/audit";
import type {
  Correction,
  MakeupTask,
  Route,
  Shift,
  SkipRequest,
  StopStatus,
} from "./domain/audit";

const STORAGE_KEY = "dfwlfront-10-audit";

const now = () => new Date().toISOString();

function seedShifts(): Shift[] {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const todayKey = rules.toDateKey(today);
  const tomorrowKey = rules.toDateKey(tomorrow);
  return [
    ...SHIFT_NAMES.map((name) => ({
      id: rules.makeShiftId(todayKey, name),
      date: todayKey,
      name,
    })),
    // 预置次日早班，便于指定补检班次
    { id: rules.makeShiftId(tomorrowKey, SHIFT_NAMES[0]), date: tomorrowKey, name: SHIFT_NAMES[0] },
  ];
}

interface AuditData {
  shifts: Shift[];
  routes: Route[];
  requests: SkipRequest[];
  makeups: MakeupTask[];
  corrections: Correction[];
}

function initialData(): AuditData {
  return { shifts: seedShifts(), routes: [], requests: [], makeups: [], corrections: [] };
}

export type AuditStore = AuditData & {
  /** 以下动作均返回错误信息，成功返回 null */
  addShift(date: string, name: string): string | null;
  createRoute(shiftId: string, area: string, inspector: string): string | null;
  confirmPoint(routeId: string, pointId: string): string | null;
  requestSkip(routeId: string, pointId: string, reason: string, makeupShiftId: string): string | null;
  decideSkip(requestId: string, approve: boolean): void;
  cancelStop(routeId: string, pointId: string, note: string): string | null;
  closeRoute(routeId: string): string | null;
  confirmMakeup(makeupId: string): string | null;
  correctStop(routeId: string, pointId: string, to: StopStatus, reason: string): string | null;
  resetAll(): void;
};

export const useAuditStore = create<AuditStore>()(
  persist(
    (set, get) => ({
      ...initialData(),

      addShift(date, name) {
        if (!date || !name) return "请选择班次日期与名称";
        const id = rules.makeShiftId(date, name);
        if (get().shifts.some((s) => s.id === id)) return "该班次已存在";
        set((s) => ({ shifts: [...s.shifts, { id, date, name }] }));
        return null;
      },

      createRoute(shiftId, area, inspector) {
        const shift = get().shifts.find((s) => s.id === shiftId);
        if (!shift) return "请选择班次";
        if (!area) return "请选择区域";
        if (!inspector.trim()) return "请填写巡检人";
        if (rules.activeRouteExists(get().routes, shift.id, area)) {
          return "同一班次同一区域只能有一条有效路线";
        }
        const route: Route = {
          id: crypto.randomUUID(),
          shiftId: shift.id,
          area,
          inspector: inspector.trim(),
          status: "active",
          stops: rules.buildStops(area),
          violations: [],
          createdAt: now(),
          closedAt: null,
        };
        set((s) => ({ routes: [route, ...s.routes] }));
        return null;
      },

      confirmPoint(routeId, pointId) {
        const route = get().routes.find((r) => r.id === routeId);
        if (!route) return "路线不存在";
        const result = rules.confirmArrival(route, get().requests, pointId, now());
        if (result.kind === "error") return result.error;
        // 越序被拦截时也会更新路线（追加越序记录）
        set((s) => ({ routes: s.routes.map((r) => (r.id === routeId ? result.route : r)) }));
        return result.kind === "violation" ? result.error : null;
      },

      requestSkip(routeId, pointId, reason, makeupShiftId) {
        const route = get().routes.find((r) => r.id === routeId);
        if (!route) return "路线不存在";
        const result = rules.requestSkip(
          route,
          get().requests,
          get().shifts,
          pointId,
          reason,
          makeupShiftId,
          now()
        );
        if (!result.ok) return result.error;
        set((s) => ({ requests: [result.value, ...s.requests] }));
        return null;
      },

      decideSkip(requestId, approve) {
        const request = get().requests.find((r) => r.id === requestId);
        if (!request || request.status !== "pending") return;
        const route = get().routes.find((r) => r.id === request.routeId);
        if (!route) return;
        const outcome = rules.decideSkip(request, route, approve, now());
        set((s) => ({
          requests: s.requests.map((r) => (r.id === requestId ? outcome.request : r)),
          routes: s.routes.map((r) => (r.id === route.id ? outcome.route : r)),
          makeups: outcome.makeup ? [outcome.makeup, ...s.makeups] : s.makeups,
        }));
      },

      cancelStop(routeId, pointId, note) {
        const route = get().routes.find((r) => r.id === routeId);
        if (!route) return "路线不存在";
        const result = rules.cancelStop(route, get().requests, pointId, note);
        if (!result.ok) return result.error;
        set((s) => ({ routes: s.routes.map((r) => (r.id === routeId ? result.value : r)) }));
        return null;
      },

      closeRoute(routeId) {
        const route = get().routes.find((r) => r.id === routeId);
        if (!route) return "路线不存在";
        const result = rules.closeRoute(route, get().requests, now());
        if (!result.ok) return result.error;
        set((s) => ({ routes: s.routes.map((r) => (r.id === routeId ? result.value : r)) }));
        return null;
      },

      confirmMakeup(makeupId) {
        const makeup = get().makeups.find((m) => m.id === makeupId);
        if (!makeup) return "补检任务不存在";
        const result = rules.confirmMakeup(makeup, get().routes, now());
        if (!result.ok) return result.error;
        set((s) => ({ makeups: s.makeups.map((m) => (m.id === makeupId ? result.value : m)) }));
        return null;
      },

      correctStop(routeId, pointId, to, reason) {
        const route = get().routes.find((r) => r.id === routeId);
        if (!route) return "路线不存在";
        const result = rules.correctStop(route, get().corrections, pointId, to, reason, now());
        if (!result.ok) return result.error;
        set((s) => ({ corrections: [...s.corrections, result.value] }));
        return null;
      },

      resetAll() {
        set(initialData());
      },
    }),
    { name: STORAGE_KEY, version: 1 }
  )
);
