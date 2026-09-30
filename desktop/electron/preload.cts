import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import {
  ENGINE_CHANGED_CHANNEL,
  LIFECYCLE_ACTIVATED_CHANNEL,
  PLAY_NOTIFICATION_SOUND_CHANNEL,
  createIpcApi,
  studiIpcRegistry,
  type EngineTopic,
  type NotificationIntent,
  type StudiRendererApi,
} from "../shared/index.js";

const studiApi = createIpcApi(studiIpcRegistry, (channel, request) =>
  ipcRenderer.invoke(channel, request),
);

const rendererApi: StudiRendererApi = Object.freeze({
  ...studiApi,
  onLifecycleActivated: (listener: (target: NotificationIntent["target"]) => void) => {
    const wrapped = (_event: IpcRendererEvent, target: NotificationIntent["target"]) => {
      listener(target);
    };
    ipcRenderer.on(LIFECYCLE_ACTIVATED_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(LIFECYCLE_ACTIVATED_CHANNEL, wrapped);
    };
  },
  onEngineChanged: (listener: (topics: readonly EngineTopic[]) => void) => {
    const wrapped = (_event: IpcRendererEvent, topics: readonly EngineTopic[]) => listener(topics);
    ipcRenderer.on(ENGINE_CHANGED_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(ENGINE_CHANGED_CHANNEL, wrapped);
    };
  },
  onNotificationSound: (listener: (fileUrl: string) => void) => {
    const wrapped = (_event: IpcRendererEvent, fileUrl: string) => {
      listener(fileUrl);
    };
    ipcRenderer.on(PLAY_NOTIFICATION_SOUND_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(PLAY_NOTIFICATION_SOUND_CHANNEL, wrapped);
    };
  },
});

contextBridge.exposeInMainWorld("studi", rendererApi);
