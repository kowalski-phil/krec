import { clipboard, Notification } from 'electron'

export function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

/** The clipboard holds only the URL; the toast is a secondary signal (Focus Assist may hide it). */
export function copyLinkAndNotify(url: string, videoTitle: string): void {
  clipboard.writeText(url)
  notify('Link copied', `${videoTitle} is ready to watch. Paste the link anywhere.`)
}
