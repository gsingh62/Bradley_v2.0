const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  version: "0.1.0"
});
