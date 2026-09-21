// 界面层：班次路线稽核台
// 只负责展示与交互，规则一律调用 store / domain

import { FormEvent, useMemo, useState } from "react";
import { AREAS, CANCEL_REASONS, SHIFT_NAMES, SKIP_REASONS, pointName } from "./data/points";
import {
  STOP_STATUS_LABEL,
  closeSummary,
  correctionsFor,
  effectiveStatus,
  isLaterShift,
  nextPendingStop,
  pendingRequestFor,
  shiftLabel,
  sortShifts,
  toDateKey,
  type StopStatus,
} from "./domain/audit";
import { useAuditStore } from "./store";

const project = {
  industry: "石油",
  title: "油站班次路线稽核台",
  subtitle:
    "每班按区域与巡检人生成点位路线，到场确认严格按序；漏检须选原因并指定补检班次，核准后方可结班；结班路线冻结，更正保留原记录并另写原因。",
  stack: ["React", "Vite", "TypeScript", "Zustand", "Ant Design"],
  metricLabels: ["进行中路线", "待核准申请", "待补检点位", "已结班路线"],
};

type Notice = { kind: "ok" | "err"; text: string } | null;
type Expanded = { type: "skip" | "cancel" | "correct"; pointId: string } | null;

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function App() {
  const store = useAuditStore();
  const { shifts, routes, requests, makeups, corrections } = store;

  const [notice, setNotice] = useState<Notice>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // 生成路线表单
  const [routeShiftId, setRouteShiftId] = useState("");
  const [routeArea, setRouteArea] = useState("");
  const [inspector, setInspector] = useState("");

  // 新增班次表单
  const [shiftDate, setShiftDate] = useState(() => toDateKey(new Date()));
  const [shiftName, setShiftName] = useState(SHIFT_NAMES[0]);

  // 点位行内表单（跳过 / 取消 / 更正）
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [skipReason, setSkipReason] = useState("");
  const [skipMakeupId, setSkipMakeupId] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [correctTo, setCorrectTo] = useState("");
  const [correctReason, setCorrectReason] = useState("");

  const sortedShifts = useMemo(() => sortShifts(shifts), [shifts]);
  const shiftById = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);

  const orderedRoutes = useMemo(
    () =>
      [...routes].sort((a, b) =>
        a.status !== b.status
          ? a.status === "active"
            ? -1
            : 1
          : b.createdAt.localeCompare(a.createdAt)
      ),
    [routes]
  );

  const route = orderedRoutes.find((r) => r.id === selectedRouteId) ?? orderedRoutes[0] ?? null;
  const routeShift = route ? shiftById.get(route.shiftId) ?? null : null;
  const nextStop = route ? nextPendingStop(route) : null;
  const laterShifts = routeShift ? sortedShifts.filter((s) => isLaterShift(s, routeShift)) : [];
  const summary = route && route.status === "closed" ? closeSummary(route) : null;

  const pendingReqs = requests.filter((r) => r.status === "pending");
  const decidedReqs = [...requests]
    .filter((r) => r.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, 3);
  const orderedMakeups = useMemo(
    () =>
      [...makeups].sort((a, b) =>
        a.status !== b.status ? (a.status === "open" ? -1 : 1) : a.shiftId.localeCompare(b.shiftId)
      ),
    [makeups]
  );

  const metrics = [
    routes.filter((r) => r.status === "active").length,
    pendingReqs.length,
    makeups.filter((m) => m.status === "open").length,
    routes.filter((r) => r.status === "closed").length,
  ];

  function flash(kind: "ok" | "err", text: string) {
    setNotice({ kind, text });
  }

  function run(err: string | null, okText: string) {
    flash(err ? "err" : "ok", err ?? okText);
  }

  function openForm(type: "skip" | "cancel" | "correct", pointId: string) {
    setExpanded((prev) =>
      prev && prev.type === type && prev.pointId === pointId ? null : { type, pointId }
    );
    setSkipReason("");
    setSkipMakeupId("");
    setCancelNote("");
    setCorrectTo("");
    setCorrectReason("");
  }

  function submitRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const shiftId = routeShiftId || sortedShifts[0]?.id || "";
    const area = routeArea || AREAS[0];
    const err = store.createRoute(shiftId, area, inspector);
    if (err) return flash("err", err);
    flash("ok", "路线已生成，请按点位顺序到场确认");
    setInspector("");
    const created = useAuditStore
      .getState()
      .routes.find((r) => r.shiftId === shiftId && r.area === area && r.status === "active");
    if (created) setSelectedRouteId(created.id);
  }

  function submitShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(store.addShift(shiftDate, shiftName), "班次已添加");
  }

  function submitSkip(routeId: string, pointId: string) {
    const err = store.requestSkip(routeId, pointId, skipReason, skipMakeupId);
    if (err) return flash("err", err);
    flash("ok", "跳过申请已提交，未经核准不能结班");
    setExpanded(null);
  }

  function submitCancel(routeId: string, pointId: string) {
    const err = store.cancelStop(routeId, pointId, cancelNote);
    if (err) return flash("err", err);
    flash("ok", "点位已取消");
    setExpanded(null);
  }

  function submitCorrect(routeId: string, pointId: string) {
    if (!correctTo) return flash("err", "请选择更正状态");
    const err = store.correctStop(routeId, pointId, correctTo as StopStatus, correctReason);
    if (err) return flash("err", err);
    flash("ok", "更正已登记，原记录保留");
    setExpanded(null);
  }

  function handleClose(routeId: string) {
    if (!window.confirm("确认结班？结班后路线冻结，只能追加更正。")) return;
    run(store.closeRoute(routeId), "已结班，路线冻结");
  }

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">{project.industry}行业 · 班次路线稽核</p>
            <h1>{project.title}</h1>
            <p className="subtitle">{project.subtitle}</p>
          </div>
          <div className="stack">
            {project.stack.map((item) => (
              <span className="tag" key={item}>
                {item}
              </span>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (window.confirm("清空全部班次、路线、补检与更正记录并重新初始化？")) {
                  store.resetAll();
                  setSelectedRouteId(null);
                  setExpanded(null);
                  flash("ok", "已重置演示数据");
                }
              }}
            >
              重置数据
            </button>
          </div>
        </header>

        <section className="metrics">
          {project.metricLabels.map((label, index) => (
            <article className="metric" key={label}>
              <span>{label}</span>
              <strong>{metrics[index]}</strong>
            </article>
          ))}
        </section>

        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

        <section className="workspace">
          <div className="panel-stack">
            <form className="panel" onSubmit={submitRoute}>
              <h2>生成巡检路线</h2>
              <div className="form-grid">
                <label>
                  班次
                  <select
                    value={routeShiftId || sortedShifts[0]?.id || ""}
                    onChange={(e) => setRouteShiftId(e.target.value)}
                  >
                    {sortedShifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {shiftLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  区域
                  <select value={routeArea || AREAS[0]} onChange={(e) => setRouteArea(e.target.value)}>
                    {AREAS.map((area) => (
                      <option key={area}>{area}</option>
                    ))}
                  </select>
                </label>
                <label>
                  巡检人
                  <input
                    value={inspector}
                    onChange={(e) => setInspector(e.target.value)}
                    placeholder="填写当班巡检人"
                  />
                </label>
                <button type="submit">按点位顺序生成路线</button>
                <p className="hint">同一班次同一区域仅允许存在一条有效路线</p>
              </div>
            </form>

            <form className="panel" onSubmit={submitShift}>
              <h2>新增班次</h2>
              <div className="form-grid">
                <label>
                  日期
                  <input
                    type="date"
                    value={shiftDate}
                    onChange={(e) => setShiftDate(e.target.value)}
                    required
                  />
                </label>
                <label>
                  班次
                  <select value={shiftName} onChange={(e) => setShiftName(e.target.value)}>
                    {SHIFT_NAMES.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="secondary">
                  添加班次
                </button>
              </div>
            </form>

            <section className="panel">
              <h2>
                跳过申请核准{" "}
                {pendingReqs.length > 0 && <span className="badge b-warn">{pendingReqs.length}</span>}
              </h2>
              {pendingReqs.length === 0 && <div className="empty">暂无待核准申请</div>}
              {pendingReqs.map((req) => {
                const fromShift = shiftById.get(req.shiftId);
                const makeupShift = shiftById.get(req.makeupShiftId);
                return (
                  <div className="mini-item" key={req.id}>
                    <div className="stop-head">
                      <strong>{pointName(req.pointId)}</strong>
                      <span className="badge b-pending">{req.area}</span>
                    </div>
                    <div className="mini-meta">
                      {fromShift ? shiftLabel(fromShift) : req.shiftId} · 原因：{req.reason}
                      <br />
                      指定补检：{makeupShift ? shiftLabel(makeupShift) : req.makeupShiftId}
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        onClick={() => {
                          store.decideSkip(req.id, true);
                          flash("ok", "已核准：点位记为漏检并生成补检任务");
                        }}
                      >
                        核准
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          store.decideSkip(req.id, false);
                          flash("ok", "已驳回：点位恢复待检");
                        }}
                      >
                        驳回
                      </button>
                    </div>
                  </div>
                );
              })}
              {decidedReqs.length > 0 && (
                <p className="mini-meta decided">
                  最近处理：
                  {decidedReqs
                    .map(
                      (r) =>
                        `${pointName(r.pointId)}（${r.status === "approved" ? "已核准" : "已驳回"}）`
                    )
                    .join("、")}
                </p>
              )}
            </section>

            <section className="panel">
              <h2>补检任务</h2>
              {orderedMakeups.length === 0 && <div className="empty">暂无补检任务</div>}
              {orderedMakeups.map((m) => {
                const makeupShift = shiftById.get(m.shiftId);
                const fromRoute = routes.find((r) => r.id === m.fromRouteId);
                const fromShift = fromRoute ? shiftById.get(fromRoute.shiftId) : undefined;
                return (
                  <div className="mini-item" key={m.id}>
                    <div className="stop-head">
                      <strong>{pointName(m.pointId)}</strong>
                      <span className="badge b-pending">{m.area}</span>
                      <span className={`badge ${m.status === "open" ? "b-warn" : "b-done"}`}>
                        {m.status === "open" ? "待补检" : "已补检"}
                      </span>
                    </div>
                    <div className="mini-meta">
                      补检班次：{makeupShift ? shiftLabel(makeupShift) : m.shiftId}
                      {fromShift && <> · 来源：{shiftLabel(fromShift)} 漏检</>}
                      {m.status === "done" && <> · 完成于 {fmtTime(m.doneAt)}</>}
                    </div>
                    {m.status === "open" && (
                      <div className="actions">
                        <button type="button" onClick={() => run(store.confirmMakeup(m.id), "补检已完成")}>
                          确认补检
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          </div>

          <section className="list-panel">
            <div className="toolbar">
              <h2>路线稽核</h2>
            </div>
            {orderedRoutes.length === 0 ? (
              <div className="empty">尚未生成路线，请先在左侧选择班次、区域与巡检人</div>
            ) : (
              <>
                <div className="route-tabs">
                  {orderedRoutes.map((r) => {
                    const s = shiftById.get(r.shiftId);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`route-tab ${route?.id === r.id ? "active" : ""} ${r.status}`}
                        onClick={() => {
                          setSelectedRouteId(r.id);
                          setExpanded(null);
                        }}
                      >
                        {s ? shiftLabel(s) : r.shiftId} · {r.area}
                        {r.status === "closed" ? "（已结班）" : ""}
                      </button>
                    );
                  })}
                </div>

                {route && routeShift && (
                  <article>
                    <div className="detail-head">
                      <div>
                        <p className="record-title">
                          {shiftLabel(routeShift)} · {route.area}
                        </p>
                        <div className="detail-meta">
                          <span>巡检人：{route.inspector}</span>
                          <span>生成于 {fmtTime(route.createdAt)}</span>
                          {route.closedAt && <span>结班于 {fmtTime(route.closedAt)}</span>}
                        </div>
                      </div>
                      <div className="actions">
                        <span className={`badge ${route.status === "active" ? "b-next" : "b-cancelled"}`}>
                          {route.status === "active" ? "进行中" : "已结班冻结"}
                        </span>
                        {route.status === "active" && (
                          <button type="button" className="danger" onClick={() => handleClose(route.id)}>
                            结班
                          </button>
                        )}
                      </div>
                    </div>

                    {route.status === "closed" && (
                      <div className="frozen-banner">
                        路线已结班冻结：原始记录不可修改，更正将保留原记录并另写原因。
                      </div>
                    )}

                    <div className="stop-list">
                      {route.stops.map((stop) => {
                        const chain = correctionsFor(corrections, route.id, stop.pointId);
                        const eff = effectiveStatus(stop, chain);
                        const pendingReq = pendingRequestFor(requests, route.id, stop.pointId);
                        const isNext = route.status === "active" && nextStop?.pointId === stop.pointId;
                        const makeupShiftOfReq = pendingReq ? shiftById.get(pendingReq.makeupShiftId) : null;
                        return (
                          <div className={`stop-row ${isNext ? "next" : ""}`} key={stop.pointId}>
                            <div className="stop-seq">{stop.order}</div>
                            <div className="stop-main">
                              <div className="stop-head">
                                <strong>{pointName(stop.pointId)}</strong>
                                <span className={`badge b-${eff}`}>{STOP_STATUS_LABEL[eff]}</span>
                                {isNext && <span className="badge b-next">下一到场</span>}
                                {pendingReq && <span className="badge b-warn">跳过待核准</span>}
                                {chain.length > 0 && (
                                  <span className="badge b-corr">更正 {chain.length} 次</span>
                                )}
                              </div>
                              <div className="stop-meta">
                                {stop.arrivedAt && <span>到场 {fmtTime(stop.arrivedAt)}</span>}
                                {stop.status === "cancelled" && stop.cancelNote && (
                                  <span>取消原因：{stop.cancelNote}</span>
                                )}
                                {pendingReq && makeupShiftOfReq && (
                                  <span>申请补检班次：{shiftLabel(makeupShiftOfReq)}</span>
                                )}
                              </div>
                              {chain.length > 0 && (
                                <div className="chain">
                                  <span>原记录：{STOP_STATUS_LABEL[stop.status]}</span>
                                  {chain.map((c) => (
                                    <span key={c.id}>
                                      → {STOP_STATUS_LABEL[c.to]}（{c.reason} · {fmtTime(c.createdAt)}）
                                    </span>
                                  ))}
                                </div>
                              )}

                              {expanded?.pointId === stop.pointId && expanded.type === "skip" && (
                                <div className="inline-form">
                                  <label>
                                    跳过原因
                                    <select
                                      value={skipReason}
                                      onChange={(e) => setSkipReason(e.target.value)}
                                    >
                                      <option value="">请选择原因</option>
                                      {SKIP_REASONS.map((r) => (
                                        <option key={r}>{r}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label>
                                    补检班次
                                    <select
                                      value={skipMakeupId}
                                      onChange={(e) => setSkipMakeupId(e.target.value)}
                                    >
                                      <option value="">请指定补检班次</option>
                                      {laterShifts.map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {shiftLabel(s)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <div className="row">
                                    <button type="button" onClick={() => submitSkip(route.id, stop.pointId)}>
                                      提交申请
                                    </button>
                                    <button type="button" className="secondary" onClick={() => setExpanded(null)}>
                                      收起
                                    </button>
                                  </div>
                                </div>
                              )}

                              {expanded?.pointId === stop.pointId && expanded.type === "cancel" && (
                                <div className="inline-form">
                                  <label>
                                    取消原因
                                    <select
                                      value={cancelNote}
                                      onChange={(e) => setCancelNote(e.target.value)}
                                    >
                                      <option value="">请选择取消原因</option>
                                      {CANCEL_REASONS.map((r) => (
                                        <option key={r}>{r}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <div className="row">
                                    <button type="button" onClick={() => submitCancel(route.id, stop.pointId)}>
                                      确认取消
                                    </button>
                                    <button type="button" className="secondary" onClick={() => setExpanded(null)}>
                                      收起
                                    </button>
                                  </div>
                                </div>
                              )}

                              {expanded?.pointId === stop.pointId && expanded.type === "correct" && (
                                <div className="inline-form">
                                  <label>
                                    更正为
                                    <select
                                      value={correctTo}
                                      onChange={(e) => setCorrectTo(e.target.value)}
                                    >
                                      <option value="">请选择更正状态</option>
                                      {(["done", "skipped", "cancelled"] as StopStatus[])
                                        .filter((s) => s !== eff)
                                        .map((s) => (
                                          <option key={s} value={s}>
                                            {STOP_STATUS_LABEL[s]}
                                          </option>
                                        ))}
                                    </select>
                                  </label>
                                  <label>
                                    更正原因
                                    <input
                                      value={correctReason}
                                      onChange={(e) => setCorrectReason(e.target.value)}
                                      placeholder="必填，说明更正依据"
                                    />
                                  </label>
                                  <div className="row">
                                    <button type="button" onClick={() => submitCorrect(route.id, stop.pointId)}>
                                      登记更正
                                    </button>
                                    <button type="button" className="secondary" onClick={() => setExpanded(null)}>
                                      收起
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="stop-actions">
                              {route.status === "active" && stop.status === "pending" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => run(store.confirmPoint(route.id, stop.pointId), "到场确认成功")}
                                  >
                                    到场确认
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => openForm("skip", stop.pointId)}
                                  >
                                    申请跳过
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => openForm("cancel", stop.pointId)}
                                  >
                                    取消点位
                                  </button>
                                </>
                              )}
                              {route.status === "closed" && (
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => openForm("correct", stop.pointId)}
                                >
                                  更正
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {route.violations.length > 0 && (
                      <div className="violations">
                        <h3>越序记录（{route.violations.length}）</h3>
                        <ul>
                          {route.violations.map((v) => (
                            <li key={v.id}>
                              {fmtTime(v.attemptedAt)} 尝试确认「{pointName(v.pointId)}」，应先到场「
                              {pointName(v.expectedPointId)}」，已拦截
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {summary && (
                      <div className="summary-grid">
                        <div>
                          <h4>漏检点位（{summary.missed.length}）</h4>
                          {summary.missed.length === 0 ? (
                            <p className="mini-meta">无</p>
                          ) : (
                            <ul>
                              {summary.missed.map((s) => (
                                <li key={s.pointId}>{pointName(s.pointId)}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <h4>越序点位（{summary.violations.length}）</h4>
                          {summary.violations.length === 0 ? (
                            <p className="mini-meta">无</p>
                          ) : (
                            <ul>
                              {summary.violations.map((v) => (
                                <li key={v.id}>
                                  {pointName(v.pointId)}（应先到场 {pointName(v.expectedPointId)}）
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <h4>取消点位（{summary.cancelled.length}）</h4>
                          {summary.cancelled.length === 0 ? (
                            <p className="mini-meta">无</p>
                          ) : (
                            <ul>
                              {summary.cancelled.map((s) => (
                                <li key={s.pointId}>
                                  {pointName(s.pointId)}（{s.cancelNote}）
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                )}
              </>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
