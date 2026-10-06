import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { UploadUpdate } from '../shared/types'
import type { KrecApi } from './api'

const api: KrecApi = {
  closePanel: () => ipcRenderer.send(IPC.panelClose),
  minimizePanel: () => ipcRenderer.send(IPC.panelMinimize),

  pickSource: () => ipcRenderer.invoke(IPC.pickerOpen),
  listSources: (withThumbnails) => ipcRenderer.invoke(IPC.pickerList, withThumbnails),
  chooseSource: (id) => ipcRenderer.send(IPC.pickerChoose, id),

  recordingBegin: (info) => ipcRenderer.invoke(IPC.recordingBegin, info),
  recordingChunk: (data) => ipcRenderer.send(IPC.recordingChunk, data),
  recordingEnd: (stats) => ipcRenderer.invoke(IPC.recordingEnd, stats),
  recordingCancel: () => ipcRenderer.invoke(IPC.recordingCancel),

  openSettings: () => ipcRenderer.send(IPC.settingsOpen),
  closeSettings: () => ipcRenderer.send(IPC.settingsClose),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  saveSettings: (update) => ipcRenderer.invoke(IPC.settingsSave, update),
  validateAws: (setupCode) => ipcRenderer.invoke(IPC.settingsValidate, setupCode),
  chooseFolder: () => ipcRenderer.invoke(IPC.settingsChooseFolder),
  setWebcamEnabled: (enabled) => ipcRenderer.send(IPC.settingsSetWebcamEnabled, enabled),

  openHistory: () => ipcRenderer.send(IPC.historyOpen),
  listHistory: () => ipcRenderer.invoke(IPC.historyList),
  deleteRecording: (historyId) => ipcRenderer.invoke(IPC.historyDelete, historyId),
  onHistoryChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.historyChanged, listener)
    return () => ipcRenderer.off(IPC.historyChanged, listener)
  },

  onUploadUpdate: (callback) => {
    const listener = (_event: IpcRendererEvent, update: UploadUpdate): void => callback(update)
    ipcRenderer.on(IPC.uploadUpdate, listener)
    return () => ipcRenderer.off(IPC.uploadUpdate, listener)
  },
  retryUpload: (historyId) => ipcRenderer.send(IPC.uploadRetry, historyId),

  showFile: (path) => ipcRenderer.send(IPC.showFile, path),
  openPath: (path) => ipcRenderer.send(IPC.openPath, path),
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  startFileDrag: (historyId) => ipcRenderer.send(IPC.fileStartDrag, historyId),
  copyVideoFile: (historyId) => ipcRenderer.invoke(IPC.fileCopy, historyId),
  copyText: (text) => ipcRenderer.send(IPC.copyText, text)
}

contextBridge.exposeInMainWorld('krec', api)
