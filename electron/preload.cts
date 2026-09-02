import { contextBridge, ipcRenderer } from "electron";

import {
  createIpcApi,
  studiIpcRegistry,
} from "../shared/index.js";

const studiApi = createIpcApi(studiIpcRegistry, (channel, request) =>
  ipcRenderer.invoke(channel, request),
);

contextBridge.exposeInMainWorld("studi", studiApi);
