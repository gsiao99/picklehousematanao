import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Alert, SelectField } from '@/components/ui/form'
import { addWalkIn, findPlayers, staffRegisterPlayer, type FoundPlayer, type StaffRegistration } from '@/features/events/api'
import { toAppError } from '@/lib/errors'
import { formatPeso } from '@/lib/money'
import type { ManageData } from './EventManagePage'
import { norm, parseLine } from './pasteParse'

/** One pasted line after matching: an account to register, a new walk-in, or skipped. */
interface Line {
  key: number
  text: string
  name: string
  phone: string | null
  matches: FoundPlayer[]
  /** player id, 'walk-in', or 'skip' */
  choice: string
  note: string | null
}


/**
 * Paste a list of names (one per line, optionally with a mobile number). Each
 * line is matched to an account by mobile number or exact name; staff confirm
 * every match before anything is saved. Lines without an account become
 * walk-ins who pay at the desk. Nobody is checked in here.
 */
export function PasteList({
  data,
  regs,
  onDone,
  onClose,
}: {
  data: ManageData
  regs: StaffRegistration[]
  onDone: () => void
  onClose: () => void
}) {
  const e = data.event
  const [text, setText] = useState('')
  const [lines, setLines] = useState<Line[] | null>(null)
  const [divisionId, setDivisionId] = useState(data.divisions[0]?.id ?? '')
  const [working, setWorking] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: number; problems: string[] } | null>(null)
  const division = data.divisions.find((d) => d.id === divisionId)
  const fee = division?.fee_centavos ?? e.fee_centavos ?? 0
  const live = regs.filter((r) => r.status === 'confirmed' || r.status === 'pending')

  async function match() {
    const raw = text.split('\n').map((l) => l.trim()).filter(Boolean)
    if (raw.length === 0) return
    if (raw.length > 80) {
      setResult({ added: 0, problems: ['Paste up to 80 names at a time.'] })
      return
    }
    setResult(null)
    const out: Line[] = []
    for (const [i, line] of raw.entries()) {
      setWorking(`Matching ${i + 1} of ${raw.length}…`)
      const { name, phone } = parseLine(line)
      let matches: FoundPlayer[] = []
      try {
        if (phone) matches = (await findPlayers(phone)).filter((p) => p.phone === phone)
        if (matches.length === 0 && name.length >= 2) matches = (await findPlayers(name)).filter((p) => norm(p.full_name) === norm(name))
      } catch {
        matches = []
      }
      const already =
        live.some((r) => matches.some((m) => m.player_id === r.player_id)) ||
        (matches.length === 0 && live.some((r) => r.is_walk_in && norm(r.player_name) === norm(name)))
      out.push({
        key: i,
        text: line,
        name,
        phone,
        matches,
        choice: already ? 'skip' : matches.length === 1 ? matches[0]!.player_id : matches.length > 1 ? '' : name.length >= 2 ? 'walk-in' : 'skip',
        note: already ? 'Already in this session' : name.length < 2 && matches.length === 0 ? 'No name found on this line' : matches.length > 1 ? 'Several accounts match: choose one' : null,
      })
    }
    setWorking(null)
    setLines(out)
  }

  async function save() {
    if (!lines) return
    const todo = lines.filter((l) => l.choice && l.choice !== 'skip')
    const problems: string[] = []
    let added = 0
    for (const [i, l] of todo.entries()) {
      setWorking(`Adding ${i + 1} of ${todo.length}…`)
      try {
        if (l.choice === 'walk-in') {
          await addWalkIn({
            eventId: e.id,
            divisionId: division?.id ?? null,
            name: l.name,
            phone: l.phone ?? undefined,
            paidCentavos: 0,
            method: null,
            payLater: fee > 0,
          })
        } else {
          await staffRegisterPlayer({ eventId: e.id, playerId: l.choice, divisionId: division?.id ?? null })
        }
        added += 1
      } catch (err) {
        problems.push(`${l.name || l.text}: ${toAppError(err).message}`)
      }
    }
    setWorking(null)
    setResult({ added, problems })
    setLines(null)
    setText('')
    onDone()
  }

  const ready = lines?.filter((l) => l.choice && l.choice !== 'skip').length ?? 0
  const unresolved = lines?.some((l) => l.choice === '') ?? false

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand-green-200 bg-brand-green-50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Paste a list</p>
          <p className="text-sm text-brand-charcoal-500">
            One person per line. Add a mobile number to match accounts surely, e.g. “Ana Reyes 0917 123 4567”. You check every match before anything is saved.
          </p>
        </div>
        <Button variant="ghost" onClick={onClose} disabled={working !== null}>
          Close
        </Button>
      </div>

      {result ? (
        <Alert tone={result.problems.length ? 'error' : 'success'}>
          {result.added > 0 ? `${result.added} added. ` : ''}
          {result.problems.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {result.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            'Check them in as they arrive.'
          )}
        </Alert>
      ) : null}

      {!lines ? (
        <>
          <label className="sr-only" htmlFor="paste-names">
            Names
          </label>
          <textarea
            id="paste-names"
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            rows={8}
            placeholder={'Ana Reyes 09171234567\nBen Cruz\nCarla Mendoza'}
            className="w-full rounded-xl border border-brand-green-200 bg-white p-3 text-sm focus:border-brand-green focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <Button onClick={() => void match()} disabled={working !== null || !text.trim()}>
              Find matches
            </Button>
            {working ? <span className="text-sm font-semibold text-brand-green" role="status">{working}</span> : null}
          </div>
        </>
      ) : (
        <>
          {data.divisions.length > 0 ? (
            <SelectField label="Level (stack) for everyone added" value={divisionId} onChange={(ev) => setDivisionId(ev.target.value)} className="max-w-xs">
              {data.divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
          ) : null}
          <ul className="divide-y divide-brand-green-100 rounded-xl border border-brand-green-100 bg-white">
            {lines.map((l) => (
              <li key={l.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="font-semibold break-words">{l.name || l.text}</span>
                  {l.phone ? <span className="text-sm text-brand-charcoal-500"> · {l.phone}</span> : null}
                  {l.note ? <span className="block text-sm text-brand-charcoal-500">{l.note}</span> : null}
                </span>
                <select
                  aria-label={`What to do with ${l.name || l.text}`}
                  value={l.choice}
                  onChange={(ev) => setLines((all) => all!.map((x) => (x.key === l.key ? { ...x, choice: ev.target.value } : x)))}
                  className="rounded-lg border border-brand-green-200 bg-white px-3 py-2 text-sm sm:max-w-72"
                >
                  {l.choice === '' ? <option value="">Choose…</option> : null}
                  {l.matches.map((m) => (
                    <option key={m.player_id} value={m.player_id}>
                      Account: {m.full_name}
                      {m.phone ? ` · ${m.phone}` : ''}
                    </option>
                  ))}
                  {l.name.length >= 2 ? <option value="walk-in">New walk-in{fee > 0 ? ` (pays ${formatPeso(fee)} at the desk)` : ''}</option> : null}
                  <option value="skip">Skip</option>
                </select>
              </li>
            ))}
          </ul>
          <p className="text-sm text-brand-charcoal-500">
            Accounts are registered for the session{fee > 0 ? ' (their fee is due as usual)' : ''}; walk-ins {fee > 0 ? 'pay at the desk' : 'are added free'}. Nobody is checked in yet.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={working !== null || ready === 0 || unresolved}>
              {`Add ${ready} player${ready === 1 ? '' : 's'}`}
            </Button>
            <Button variant="ghost" onClick={() => setLines(null)} disabled={working !== null}>
              Back to the list
            </Button>
            {unresolved ? <span className="text-sm text-brand-charcoal-500">Choose an account (or Skip) where several match.</span> : null}
            {working ? <span className="text-sm font-semibold text-brand-green" role="status">{working}</span> : null}
          </div>
        </>
      )}
    </div>
  )
}
