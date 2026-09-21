import { useState } from "react";
import { pointById, regionById, shiftDefs, skipReasons } from "../data/points";
import {
  CheckResult,
  Correction,
  Route,
  RoutePoint,
  closeBlockers,
  effectivePoint,
  fmtTime,
  nextPendingPoint,
  nextShiftKey,
  parseShiftKey,
  shiftKeyOf,
  shiftLabel
} from "../domain/audit";
import { useAuditStore } from "../store";

const statusText: Record<RoutePoint["status"], string> = {
  pending: "待检",
  checked: "已检",
  skipped: "漏检·跳过",
  cancelled: "已取消"
};

function PointRow({
  route,
  point,
  corrections
}: {
  route: Route;
  point: RoutePoint;
  corrections: Correction[];
}) {
  const confirm = useAuditStore((state) => state.confirm);
  const applySkip = useAuditStore((state) => state.applySkip);
  const decideSkip = useAuditStore((state) => state.decideSkip);
  const cancelPointAction = useAuditStore((state) => state.cancelPoint);
  const correct = useAuditStore((state) => state.correct);

  const frozen = route.status === "closed";
  const isNext = !frozen && nextPendingPoint(route)?.pointId === point.pointId;
  const meta = pointById(point.pointId);
  const effective = effectivePoint(point, corrections);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult>("normal");
  const [note, setNote] = useState("");
  const [skipOpen, setSkipOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const suggested = parseShiftKey(nextShiftKey(route.shiftKey));
  const [skipReason, setSkipReason] = useState(skipReasons[0]);
  const [makeupDate, setMakeupDate] = useState(suggested.date);
  const [makeupShiftId, setMakeupShiftId] = useState(suggested.shiftId);
  const [cancelReason, setCancelReason] = useState("");
  const [correctField, setCorrectField] = useState<"result" | "note">("result");
  const [correctTo, setCorrectTo] = useState("normal");
  const [correctReason, setCorrectReason] = useState("");

  function run(action: () => string | null, after?: () => void) {
    const message = action();
    setError(message);
    if (!message && after) after();
  }

  return (
    <div className={`point-row ${isNext ? "is-next" : ""}`}>
      <div className="point-head">
        <div>
          <strong>
            {point.order}. {meta?.name ?? point.pointId}
          </strong>
          <span className="point-loc">{meta?.location}</span>
        </div>
        <div className="point-badges">
          {isNext ? <span className="badge b-next">下一点位</span> : null}
          <span className={`badge b-${point.status}`}>{statusText[point.status]}</span>
          {point.status === "checked" ? (
            <span className={`badge ${effective.result === "abnormal" ? "b-abnormal" : "b-normal"}`}>
              {effective.result === "abnormal" ? "异常" : "正常"}
            </span>
          ) : null}
          {frozen && effective.corrected ? <span className="badge b-corrected">已更正</span> : null}
        </div>
      </div>

      {point.status === "checked" ? (
        <p className="point-info">
          {fmtTime(point.checkedAt)} 到场确认{effective.note ? ` · ${effective.note}` : ""}
        </p>
      ) : null}
      {point.status === "skipped" && point.skipRequest ? (
        <p className="point-info">
          原因：{point.skipRequest.reason} · 补检班次：{shiftLabel(point.skipRequest.makeupShiftKey)}
        </p>
      ) : null}
      {point.status === "cancelled" ? <p className="point-info">取消原因：{point.cancelReason}</p> : null}
      {point.skipRequest && !point.skipRequest.approved ? (
        <div className="skip-pending">
          <span>
            跳过申请待核准：{point.skipRequest.reason} · 补检 {shiftLabel(point.skipRequest.makeupShiftKey)}
          </span>
          {!frozen ? (
            <span className="actions">
              <button type="button" onClick={() => decideSkip(route.id, point.pointId, true)}>
                核准
              </button>
              <button type="button" className="secondary" onClick={() => decideSkip(route.id, point.pointId, false)}>
                驳回
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      {!frozen && point.status === "pending" && !point.skipRequest ? (
        <div className="point-actions">
          {isNext ? (
            <div className="inline-form">
              <select value={result} onChange={(event) => setResult(event.target.value as CheckResult)}>
                <option value="normal">正常</option>
                <option value="abnormal">异常</option>
              </select>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="现场备注（可选）"
              />
              <button type="button" onClick={() => run(() => confirm(route.id, point.pointId, result, note))}>
                到场确认
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => run(() => confirm(route.id, point.pointId, "normal", ""))}>
              到场确认
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setSkipOpen(!skipOpen);
              setCancelOpen(false);
            }}
          >
            申请跳过
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setCancelOpen(!cancelOpen);
              setSkipOpen(false);
            }}
          >
            取消点位
          </button>
        </div>
      ) : null}

      {skipOpen ? (
        <div className="inline-form sub-form">
          <select value={skipReason} onChange={(event) => setSkipReason(event.target.value)}>
            {skipReasons.map((reason) => (
              <option key={reason}>{reason}</option>
            ))}
          </select>
          <input type="date" value={makeupDate} onChange={(event) => setMakeupDate(event.target.value)} />
          <select value={makeupShiftId} onChange={(event) => setMakeupShiftId(event.target.value)}>
            {shiftDefs.map((shift) => (
              <option key={shift.id} value={shift.id}>
                补检：{shift.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              run(
                () => applySkip(route.id, point.pointId, skipReason, shiftKeyOf(makeupDate, makeupShiftId)),
                () => setSkipOpen(false)
              )
            }
          >
            提交申请
          </button>
        </div>
      ) : null}

      {cancelOpen ? (
        <div className="inline-form sub-form">
          <input
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="取消原因（必填）"
          />
          <button
            type="button"
            className="danger"
            onClick={() => run(() => cancelPointAction(route.id, point.pointId, cancelReason), () => setCancelOpen(false))}
          >
            确认取消
          </button>
        </div>
      ) : null}

      {frozen ? (
        <div className="point-actions">
          <button type="button" className="secondary" onClick={() => setCorrectOpen(!correctOpen)}>
            更正
          </button>
        </div>
      ) : null}

      {correctOpen ? (
        <div className="inline-form sub-form">
          <select
            value={correctField}
            onChange={(event) => {
              const field = event.target.value as "result" | "note";
              setCorrectField(field);
              setCorrectTo(field === "result" ? "normal" : "");
            }}
          >
            <option value="result">巡检结果</option>
            <option value="note">备注</option>
          </select>
          {correctField === "result" ? (
            <select value={correctTo} onChange={(event) => setCorrectTo(event.target.value)}>
              <option value="normal">正常</option>
              <option value="abnormal">异常</option>
            </select>
          ) : (
            <input value={correctTo} onChange={(event) => setCorrectTo(event.target.value)} placeholder="更正后的备注" />
          )}
          <input
            value={correctReason}
            onChange={(event) => setCorrectReason(event.target.value)}
            placeholder="更正原因（必填）"
          />
          <button
            type="button"
            onClick={() =>
              run(
                () => correct(route.id, point.pointId, correctField, correctTo, correctReason),
                () => {
                  setCorrectOpen(false);
                  setCorrectReason("");
                }
              )
            }
          >
            提交更正
          </button>
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}

function SummaryChips({ title, pointIds }: { title: string; pointIds: string[] }) {
  return (
    <div className="summary-line">
      <span className="summary-title">{title}</span>
      {pointIds.length === 0 ? (
        <span className="chip chip-empty">无</span>
      ) : (
        pointIds.map((id) => (
          <span className="chip" key={id}>
            {pointById(id)?.name ?? id}
          </span>
        ))
      )}
    </div>
  );
}

export default function RouteCard({ route, corrections }: { route: Route; corrections: Correction[] }) {
  const closeRoute = useAuditStore((state) => state.closeRoute);
  const [error, setError] = useState<string | null>(null);
  const region = regionById(route.regionId);
  const blockers = closeBlockers(route);
  const frozen = route.status === "closed";

  return (
    <article className={`record route-card ${frozen ? "is-closed" : ""}`}>
      <div className="record-head">
        <div>
          <p className="record-title">
            {shiftLabel(route.shiftKey)} · {region?.name ?? route.regionId}
          </p>
          <p className="route-meta">
            巡检人：{route.inspector} · 开班 {fmtTime(route.createdAt)}
            {route.closedAt ? ` · 结班 ${fmtTime(route.closedAt)}` : ""}
          </p>
        </div>
        <span className={`badge ${frozen ? "b-closed" : "b-active"}`}>{frozen ? "已结班冻结" : "进行中"}</span>
      </div>

      {route.violations.length > 0 ? (
        <p className="violations">
          越序尝试 {route.violations.length} 次：
          {[...new Set(route.violations.map((item) => pointById(item.pointId)?.name ?? item.pointId))].join("、")}
        </p>
      ) : null}

      <div className="point-list">
        {route.points.map((point) => (
          <PointRow key={point.pointId} route={route} point={point} corrections={corrections} />
        ))}
      </div>

      {!frozen ? (
        <div className="close-bar">
          {blockers.length > 0 ? (
            <span className="hint">暂不能结班：{blockers.join("；")}</span>
          ) : (
            <span className="hint">全部点位已处理，可以结班。</span>
          )}
          <button
            type="button"
            disabled={blockers.length > 0}
            onClick={() => setError(closeRoute(route.id))}
          >
            结班并生成小结
          </button>
        </div>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}

      {frozen && route.summary ? (
        <div className="summary">
          <h3>结班小结</h3>
          <SummaryChips title="漏检" pointIds={route.summary.missed} />
          <SummaryChips title="越序" pointIds={route.summary.outOfOrder} />
          <SummaryChips title="取消" pointIds={route.summary.cancelled} />
        </div>
      ) : null}

      {frozen && corrections.length > 0 ? (
        <div className="corrections">
          <h3>更正链（原记录保留）</h3>
          {corrections.map((item) => (
            <p key={item.id} className="correction-line">
              {fmtTime(item.createdAt)} · {pointById(item.pointId)?.name ?? item.pointId} ·{" "}
              {item.field === "result" ? "巡检结果" : "备注"}：{item.from || "（空）"} → {item.to} · 原因：
              {item.reason}
            </p>
          ))}
        </div>
      ) : null}
    </article>
  );
}
