import { FormEvent, useState } from "react";
import { inspectors, regions, shiftDefs } from "../data/points";
import { shiftKeyOf, todayStr } from "../domain/audit";
import { useAuditStore } from "../store";

export default function ShiftForm() {
  const createRoute = useAuditStore((state) => state.createRoute);
  const [date, setDate] = useState(todayStr());
  const [shiftId, setShiftId] = useState(shiftDefs[0].id);
  const [regionId, setRegionId] = useState(regions[0].id);
  const [inspector, setInspector] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = createRoute({ shiftKey: shiftKeyOf(date, shiftId), regionId, inspector });
    setError(message);
    if (!message) setInspector("");
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>开班生成路线</h2>
      <div className="form-grid">
        <label>
          班次日期
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>
          班次
          <select value={shiftId} onChange={(event) => setShiftId(event.target.value)}>
            {shiftDefs.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {shift.name}（{shift.window}）
              </option>
            ))}
          </select>
        </label>
        <label>
          区域
          <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          巡检人
          <select value={inspector} onChange={(event) => setInspector(event.target.value)} required>
            <option value="">请选择</option>
            {inspectors.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <button type="submit">按点位顺序生成路线</button>
        {error ? <p className="error-text">{error}</p> : null}
        <p className="hint">同一班次同一区域只能有一条有效路线；结班后可再次开班。</p>
      </div>
    </form>
  );
}
