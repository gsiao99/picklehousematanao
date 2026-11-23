import type { Notification } from '@/features/payments/api'

/**
 * Groups for the dashboard activity filter, worked out from each staff
 * notification's kind, title and link (see the audit_log → staff_activity
 * trigger for the titles). Checked in this order; the first match wins.
 */
export type ActivityGroup = 'payments' | 'bookings' | 'checkins' | 'players' | 'events' | 'courts' | 'settings' | 'other'

export const ACTIVITY_GROUPS: { id: ActivityGroup; label: string }[] = [
  { id: 'bookings', label: 'Bookings' },
  { id: 'payments', label: 'Payments' },
  { id: 'players', label: 'Players & staff' },
  { id: 'events', label: 'Events' },
  { id: 'checkins', label: 'Check-ins' },
  { id: 'courts', label: 'Courts' },
  { id: 'settings', label: 'Settings' },
  { id: 'other', label: 'Other' },
]

export function activityGroup(n: Pick<Notification, 'kind' | 'title' | 'link'>): ActivityGroup {
  const title = n.title ?? ''
  const link = n.link ?? ''
  if (n.kind === 'payment_submitted' || /payment|paid|refund|waived/i.test(title)) return 'payments'
  if (/checked in/i.test(title)) return 'checkins'
  if (/booking/i.test(title) || link.startsWith('/admin/bookings')) return 'bookings'
  if (/player|role|permission/i.test(title) || link.startsWith('/admin/players') || link.startsWith('/admin/members')) return 'players'
  if (/event|registration|division|match/i.test(title) || link.startsWith('/admin/events')) return 'events'
  if (/court|private event/i.test(title) || link.startsWith('/admin/schedule')) return 'courts'
  if (/settings/i.test(title) || link.startsWith('/admin/settings')) return 'settings'
  return 'other'
}
