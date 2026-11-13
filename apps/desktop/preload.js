// 桌面版的 preload：目前只暴露一点只读信息，不做任何特权操作。
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("insightVault", {
  platform: process.platform,
  desktop: true,
});
