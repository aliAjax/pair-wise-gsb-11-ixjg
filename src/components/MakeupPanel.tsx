import { pointById, regionById } from "../data/points";
import { MakeupTask, Route, fmtTime, shiftLabel } from "../domain/audit";
import { useAuditStore } from "../store";

export default function MakeupPanel({ makeups, routes }: { makeups: MakeupTask[]; routes: Route[] }) {
  const completeMakeup = useAuditStore((state) => state.completeMakeup);
  const sorted = [...makeups].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return (
    <section className="panel">
      <h2>补检任务</h2>
      {sorted.length === 0 ? (
        <div className="empty">暂无补检任务</div>
      ) : (
        <div className="makeup-list">
          {sorted.map((task) => {
            const route = routes.find((item) => item.id === task.routeId);
            const point = pointById(task.pointId);
            return (
              <div className="makeup-item" key={task.id}>
                <div className="makeup-head">
                  <strong>{point?.name ?? task.pointId}</strong>
                  <span className={`badge ${task.status === "done" ? "b-closed" : "b-active"}`}>
                    {task.status === "done" ? "已补检" : "待补检"}
                  </span>
                </div>
                <p className="point-info">
                  来源：{route ? `${shiftLabel(route.shiftKey)} · ${regionById(route.regionId)?.name ?? ""}` : task.routeId}
                  <br />
                  补检班次：{shiftLabel(task.shiftKey)} · 原因：{task.reason}
                  {task.doneAt ? (
                    <>
                      <br />
                      完成于 {fmtTime(task.doneAt)}
                    </>
                  ) : null}
                </p>
                {task.status === "pending" ? (
                  <button type="button" className="secondary" onClick={() => completeMakeup(task.id)}>
                    完成补检
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
