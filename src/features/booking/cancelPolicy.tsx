import { venue } from '@/config/venue'
import { cn } from '@/lib/cn'
import { cutoffText, deadlineText, useCancelRule } from './cancelRule'

/** "call the club at 0917 …", or "contact the club" when no phone is set yet. */
export function ContactClub() {
  const phone = venue.contact.phone
  return phone ? (
    <>
      call the club at{' '}
      <a href={`tel:${phone.replace(/\s+/g, '')}`} className="font-semibold whitespace-nowrap underline underline-offset-4">
        {phone}
      </a>
    </>
  ) : (
    <>contact the club</>
  )
}

/** The rule in one line, shown before booking and on the manage link. Refunds are handled by staff. */
export function CancelPolicyNote({ firstStartsAt, className }: { firstStartsAt: string | null; className?: string }) {
  const rule = useCancelRule(firstStartsAt)
  if (rule.kind === 'loading' || rule.kind === 'unknown') return null
  return (
    <p className={cn('text-sm', className)}>
      {rule.kind === 'until' ? (
        <>
          You can cancel online up to {cutoffText(rule.minutes)} before your first time (until {deadlineText(rule.deadline)}). If you
          already paid, the club arranges your refund. After that, <ContactClub />.
        </>
      ) : (
        <>
          Your first time starts in less than {cutoffText(rule.minutes)}, so this booking cannot be cancelled online. If your plans
          change, <ContactClub />.
        </>
      )}
    </p>
  )
}
