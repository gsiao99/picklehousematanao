export interface FaqItem {
  id: string
  question: string
  answer: string
}

/**
 * Answers describe how the club and the booking system work.
 * They avoid prices, hours and policies that are not yet confirmed.
 */
export const faqItems: FaqItem[] = [
  {
    id: 'how-to-book',
    question: 'How do I book a court?',
    answer:
      'Choose a court and time on the live schedule, then book with your name and mobile number. No account is needed. You get a reference code and a private booking link: keep the link, it is how you pay, check or cancel your booking. Pay by GCash and upload your receipt, or pay cash at the desk. Staff check every payment.',
  },
  {
    id: 'multiple',
    question: 'Can I book more than one court or separate time slots?',
    answer:
      'Yes. Choose any mix of courts and times, for example one court in the afternoon and another in the evening, and book them together.',
  },
  {
    id: 'payment',
    question: 'Which payment methods do you accept?',
    answer:
      'GCash or cash. The GCash details are shown at checkout, and every payment is checked by our staff before a booking is confirmed.',
  },
  {
    id: 'open-play',
    question: 'What is open play?',
    answer:
      'Open play is a drop-in session where you play with whoever is there. Check in, put your paddle in the stack, and you will be called to the next free court with three other players at your level.',
  },
  {
    id: 'account',
    question: 'Do I need an account?',
    answer:
      'No. You book with your name and mobile number. Your name shows on the court board; your number is only seen by club staff. Keep your booking link: anyone with it can see, pay for or cancel that booking.',
  },
  {
    id: 'cancel',
    question: 'Can I cancel?',
    answer:
      'Yes, from your booking link, up to 30 minutes before your first time. If you already paid, the club arranges your refund.',
  },
  {
    id: 'tournaments',
    question: 'How do tournaments work?',
    answer:
      'Each tournament lists its divisions, format, entry fee and schedule when registration opens. You register with your partner, pay the entry fee, and follow the brackets and results on the event page.',
  },
  {
    id: 'rates',
    question: 'How much does it cost to play?',
    answer:
      '₱100 from 8:00 AM to 5:00 PM and ₱200 from 5:00 PM to 10:00 PM. Whether these are per court or per player, and the rate from 10:00 PM to 11:00 PM, are to be announced. The price is always shown before you pay.',
  },
]
