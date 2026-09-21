// 点位数据层：区域、点位（含顺序）、班次定义、巡检人、跳过原因。
// 只放静态配置，不含任何稽核规则。

export interface Region {
  id: string;
  name: string;
}

export interface CheckPoint {
  id: string;
  regionId: string;
  name: string;
  order: number;
  location: string;
}

export interface ShiftDef {
  id: string;
  name: string;
  window: string;
}

export const regions: Region[] = [
  { id: "fuel", name: "加油区" },
  { id: "tank", name: "油罐区" },
  { id: "shop", name: "收银区" }
];

export const checkPoints: CheckPoint[] = [
  { id: "fuel-01", regionId: "fuel", name: "加油机1号", order: 1, location: "1号加油岛" },
  { id: "fuel-02", regionId: "fuel", name: "加油机2号", order: 2, location: "2号加油岛" },
  { id: "fuel-03", regionId: "fuel", name: "油气回收泵", order: 3, location: "3号加油岛" },
  { id: "fuel-04", regionId: "fuel", name: "急停按钮", order: 4, location: "站房外墙" },
  { id: "tank-01", regionId: "tank", name: "卸油口密封", order: 1, location: "卸油区" },
  { id: "tank-02", regionId: "tank", name: "量油孔", order: 2, location: "罐区北侧" },
  { id: "tank-03", regionId: "tank", name: "呼吸阀", order: 3, location: "罐顶" },
  { id: "tank-04", regionId: "tank", name: "防渗池液位", order: 4, location: "罐区南侧" },
  { id: "shop-01", regionId: "shop", name: "收银台灭火器", order: 1, location: "营业厅" },
  { id: "shop-02", regionId: "shop", name: "静电释放柱", order: 2, location: "营业厅门口" },
  { id: "shop-03", regionId: "shop", name: "监控摄像头", order: 3, location: "收银台上方" }
];

export const shiftDefs: ShiftDef[] = [
  { id: "morning", name: "早班", window: "06:00-14:00" },
  { id: "middle", name: "中班", window: "14:00-22:00" },
  { id: "night", name: "晚班", window: "22:00-06:00" }
];

export const inspectors = ["何鑫", "王莉", "张远", "刘畅"];

export const skipReasons = ["设备停用", "检修中", "安全管控", "恶劣天气", "其他"];

export function pointById(id: string): CheckPoint | undefined {
  return checkPoints.find((point) => point.id === id);
}

export function regionById(id: string): Region | undefined {
  return regions.find((region) => region.id === id);
}

export function pointsOfRegion(regionId: string): CheckPoint[] {
  return checkPoints
    .filter((point) => point.regionId === regionId)
    .sort((a, b) => a.order - b.order);
}
