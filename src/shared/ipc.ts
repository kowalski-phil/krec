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
  recordingCancel: 'recording:cancel',

  settingsOpen: 'settings:open',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsValidate: 'settings:validate',
  settingsChooseFolder: 'settings:choose-folder',
  settingsClose: 'settings:close',
  settingsSetWebcamEnabled: 'settings:set-webcam-enabled',

  historyOpen: 'history:open',
  historyList: 'history:list',
  historyDelete: 'history:delete',
  historyChanged: 'history:changed', // main -> renderer: an item was added or removed

  uploadUpdate: 'upload:update', // main -> renderer
  uploadRetry: 'upload:retry',

  showFile: 'file:show',
  openPath: 'file:open-path',
  openExternal: 'link:open',
  fileStartDrag: 'file:start-drag',
  fileCopy: 'file:copy-to-clipboard',
  copyText: 'clipboard:copy'
} as const
