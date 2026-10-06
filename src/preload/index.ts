import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { KrecApi } from './api'

const api: KrecApi = {
  closePanel: () => ipcRenderer.send(IPC.panelClose),
  minimizePanel: () => ipcRenderer.send(IPC.panelMinimize),

  pickSource: () => ipcRenderer.invoke(IPC.pickerOpen),
  listSources: (withThumbnails) => ipcRenderer.invoke(IPC.pickerList, withThumbnails),
  chooseSource: (id) => ipcRenderer.send(IPC.pickerChoose, id),

  recordingBegin: (info) => ipcRenderer.invoke(IPC.recordingBegin, info),
  recordingChunk: (data) => ipcRenderer.send(IPC.recordingChunk, data),
  recordingEnd: () => ipcRenderer.invoke(IPC.recordingEnd),

  showFile: (path) => ipcRenderer.send(IPC.showFile, path)
}

contextBridge.exposeInMainWorld('krec', api)
