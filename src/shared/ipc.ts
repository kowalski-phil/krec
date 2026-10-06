// Channel names shared by main, preload and renderer. Keep every IPC name here.
export const IPC = {
  panelClose: 'panel:close',
  panelMinimize: 'panel:minimize',

  pickerOpen: 'picker:open',
  pickerList: 'picker:list',
  pickerChoose: 'picker:choose',

  recordingBegin: 'recording:begin',
  recordingChunk: 'recording:chunk',
  recordingEnd: 'recording:end',

  showFile: 'file:show'
} as const
