import { useMemo } from "react";
import MakeupPanel from "./components/MakeupPanel";
import RouteCard from "./components/RouteCard";
import ShiftForm from "./components/ShiftForm";
import { useAuditStore } from "./store";

export default function App() {
  const routes = useAuditStore((state) => state.routes);
  const makeups = useAuditStore((state) => state.makeups);
  const corrections = useAuditStore((state) => state.corrections);

  const metrics = useMemo(() => {
    const active = routes.filter((route) => route.status === "active");
    const awaiting = active.reduce(
      (count, route) => count + route.points.filter((point) => point.skipRequest && !point.skipRequest.approved).length,
      0
    );
    return [
      { label: "有效路线", value: active.length },
      { label: "待核准跳过", value: awaiting },
      { label: "待补检", value: makeups.filter((task) => task.status === "pending").length },
      { label: "已结班", value: routes.length - active.length }
    ];
  }, [routes, makeups]);

  const sortedRoutes = useMemo(
    () => [...routes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [routes]
  );

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">石油行业 · 班次路线稽核</p>
            <h1>油站班次路线稽核台</h1>
            <p className="subtitle">
              每班按区域和巡检人生成点位路线，到场确认不可越序；漏检须申请跳过并指定补检班次，
              未经核准不能结班；结班路线冻结，更正保留原记录并另写原因。
            </p>
          </div>
          <div className="stack">
            {["React", "Vite", "TypeScript", "Zustand"].map((item) => (
              <span className="tag" key={item}>
                {item}
              </span>
            ))}
          </div>
        </header>

        <section className="metrics">
          {metrics.map((metric) => (
            <article className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </section>

        <section className="workspace">
          <div className="side">
            <ShiftForm />
            <MakeupPanel makeups={makeups} routes={routes} />
          </div>

          <section className="list-panel">
            <div className="toolbar">
              <h2>路线稽核</h2>
            </div>
            <div className="record-grid">
              {sortedRoutes.length === 0 ? (
                <div className="empty">暂无路线，请先在左侧开班</div>
              ) : (
                sortedRoutes.map((route) => (
                  <RouteCard
                    key={route.id}
                    route={route}
                    corrections={corrections.filter((item) => item.routeId === route.id)}
                  />
                ))
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
