import { describe, expect, it } from 'vitest'
import { STAFF_NOTIFICATION_KINDS } from '@/features/payments/api'
import { createBackend, demoSignInAs } from './backend'
import { db } from './engine'

describe('demo notifications by scope', () => {
  it('keeps team alerts and personal notifications apart', async () => {
    const client = createBackend(null)
    demoSignInAs('demo-player')
    db.notifications = [
      { id: 'n1', user_id: 'demo-player', kind: 'staff_activity', title: 'New booking', body: null, link: null, read_at: null, created_at: '2026-11-02T01:00:00Z' },
      { id: 'n2', user_id: 'demo-player', kind: 'payment_submitted', title: 'Payment to check', body: null, link: null, read_at: null, created_at: '2026-11-02T02:00:00Z' },
      { id: 'n3', user_id: 'demo-player', kind: 'payment_approved', title: 'Payment approved', body: null, link: null, read_at: null, created_at: '2026-11-02T03:00:00Z' },
    ]
    const team = await client.from('notifications').select('id').in('kind', STAFF_NOTIFICATION_KINDS)
    const personal = await client.from('notifications').select('id').not('kind', 'in', `(${STAFF_NOTIFICATION_KINDS.join(',')})`)
    expect((team.data ?? []).map((r) => r.id).sort()).toEqual(['n1', 'n2'])
    expect((personal.data ?? []).map((r) => r.id)).toEqual(['n3'])
  })
})
