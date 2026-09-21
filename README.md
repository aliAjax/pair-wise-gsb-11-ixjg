# 油站班次路线稽核台

- 行业：石油
- 技术栈：React、Vite、TypeScript、Zustand、Ant Design
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

## 功能

- 每班选择区域与巡检人，按点位顺序生成巡检路线；同一班次同一区域仅允许一条有效路线
- 到场确认严格按序，越序确认会被拦截并记入越序记录
- 漏检点位可申请跳过：须选择原因并指定补检班次，未经核准不能结班；核准后生成补检任务
- 结班时汇总漏检、越序与取消点位；已结班路线冻结，更正保留原记录并追加原因（更正链）
- 数据持久化在浏览器 localStorage，刷新后班次、路线、补检与更正链保持一致

## 代码结构

- `src/data/points.ts`：点位、班次、原因等基础数据
- `src/domain/audit.ts`：稽核规则（纯函数，不依赖界面与存储）
- `src/store.ts`：Zustand 状态与 localStorage 持久化
- `src/App.tsx`：界面
