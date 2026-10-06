import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { KrecApi } from './api'

const api: KrecApi = {
  closePanel: () => ipcRenderer.send(IPC.panelClose),
  minimizePanel: () => ipcRenderer.send(IPC.panelMinimize)
}

contextBridge.exposeInMainWorld('krec', api)
