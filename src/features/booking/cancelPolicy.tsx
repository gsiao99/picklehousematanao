import { venue } from '@/config/venue'
import { cn } from '@/lib/cn'
import { deadlineText, useCancelRule } from './cancelRule'

/** "call the club at 0909 280 0571", or "contact the club" when no phone is set. */
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

/** The rule in one line, shown in the cart before the player reserves. */
export function CancelPolicyNote({ firstStartsAt, className }: { firstStartsAt: string | null; className?: string }) {
  const rule = useCancelRule(firstStartsAt)
  if (rule.kind === 'loading' || rule.kind === 'unknown') return null
  return (
    <p className={cn('text-sm', className)}>
      {rule.kind === 'until' ? (
        <>
          You can cancel up to {rule.hours} hours before your first time (until {deadlineText(rule.deadline)}). After that, <ContactClub />.
        </>
      ) : rule.kind === 'too_late' ? (
        <>
          Your first time starts in less than {rule.hours} hours, so this booking cannot be cancelled online. If your plans change, <ContactClub />.
        </>
      ) : (
        <>
          Once reserved, only the club can cancel this booking. If your plans change, <ContactClub />.
        </>
      )}
    </p>
  )
}
