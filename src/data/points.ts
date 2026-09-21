// 点位数据层：区域、点位顺序、班次名称与稽核原因选项
// 只包含静态基础数据，不含任何稽核规则与界面逻辑

export interface AreaPoint {
  id: string;
  area: string;
  name: string;
  /** 点位在区域内的巡检顺序，从 1 开始 */
  order: number;
}

export const AREAS = ["加油区", "油罐区", "收银区"];

export const SHIFT_NAMES = ["早班", "中班", "晚班"];

export const SKIP_REASONS = [
  "设备停用待修",
  "区域封闭施工",
  "安全管控禁入",
  "车辆占道无法靠近",
  "其他",
];

export const CANCEL_REASONS = ["点位已拆除", "计划调整取消", "点位重复", "其他"];

export const POINTS: AreaPoint[] = [
  // 加油区：从入口到加油岛
  { id: "jy-01", area: "加油区", name: "入口静电释放柱", order: 1 },
  { id: "jy-02", area: "加油区", name: "加油机1号", order: 2 },
  { id: "jy-03", area: "加油区", name: "加油机2号", order: 3 },
  { id: "jy-04", area: "加油区", name: "油气回收接口", order: 4 },
  { id: "jy-05", area: "加油区", name: "加油岛灭火器", order: 5 },
  // 油罐区：从卸油口到罐区周界
  { id: "yg-01", area: "油罐区", name: "卸油口密封", order: 1 },
  { id: "yg-02", area: "油罐区", name: "油罐呼吸阀", order: 2 },
  { id: "yg-03", area: "油罐区", name: "液位仪探头", order: 3 },
  { id: "yg-04", area: "油罐区", name: "防渗池观察井", order: 4 },
  { id: "yg-05", area: "油罐区", name: "罐区静电接地桩", order: 5 },
  // 收银区
  { id: "sy-01", area: "收银区", name: "收银台灭火器", order: 1 },
  { id: "sy-02", area: "收银区", name: "应急照明与出口指示", order: 2 },
  { id: "sy-03", area: "收银区", name: "监控摄像头", order: 3 },
  { id: "sy-04", area: "收银区", name: "配电箱", order: 4 },
];

/** 取某区域的点位，按巡检顺序排序 */
export function pointsOfArea(area: string): AreaPoint[] {
  return POINTS.filter((point) => point.area === area).sort((a, b) => a.order - b.order);
}

export function pointName(pointId: string): string {
  return POINTS.find((point) => point.id === pointId)?.name ?? pointId;
}
