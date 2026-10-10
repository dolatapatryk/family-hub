import type { GoogleCalendarFreshnessSource } from './types'

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function oldestLastSuccess(sources: GoogleCalendarFreshnessSource[]): string | null {
  const values = sources
    .map(source => source.lastSuccessfulSyncAt)
    .filter((value): value is string => value !== null)
    .map(value => ({ value, instant: Date.parse(value) }))
    .filter(value => Number.isFinite(value.instant))
    .sort((left, right) => left.instant - right.instant)
  return values[0]?.value ?? null
}

function failureMessage(sources: GoogleCalendarFreshnessSource[]): string {
  const errorCode = sources.find(source => source.syncStatus === 'failed')?.syncErrorCode
  if (errorCode === 'rate_limited') return 'Google ograniczył import. Właściciel połączenia może spróbować ponownie za chwilę.'
  if (errorCode === 'network_error') return 'Nie udało się połączyć z Google. Właściciel połączenia może ponowić synchronizację.'
  return 'Ostatnia próba synchronizacji nie powiodła się. Poproś właściciela połączenia o ponowną synchronizację.'
}

export function GoogleCalendarFreshness({
  sources,
  pending,
  error,
  onRetry,
}: {
  sources: GoogleCalendarFreshnessSource[] | undefined
  pending: boolean
  error: Error | null
  onRetry: () => void
}) {
  if (pending) return null

  if (error) return <aside className="google-calendar-freshness google-calendar-freshness-warning" aria-live="polite">
    <strong>Nie można sprawdzić stanu importu Google</strong>
    <p>Spróbuj ponownie za chwilę.</p>
    <button className="link-button" type="button" onClick={onRetry}>Spróbuj ponownie</button>
  </aside>

  if (!sources?.length) return null

  const lastSuccess = oldestLastSuccess(sources)
  const noSuccessfulImport = sources.some(source => source.lastSuccessfulSyncAt === null)
  const needsReconnect = sources.some(source => source.connectionStatus === 'reconnect_required')
  const hasUnavailableSource = sources.some(source => source.accessStatus === 'lost' || source.connectionStatus !== 'connected')
  const hasFailedSource = sources.some(source => source.syncStatus === 'failed')
  const hasRunningSource = sources.some(source => source.syncStatus === 'running')
  const dateLabel = lastSuccess
    ? sources.length === 1
      ? `Ostatni udany import: ${formatDate(lastSuccess)}`
      : `Najstarszy ostatni udany import: ${formatDate(lastSuccess)}`
    : 'Brak udanego importu.'

  if (needsReconnect) return <aside className="google-calendar-freshness google-calendar-freshness-warning" aria-live="polite">
    <strong>Konto Google wymaga ponownego połączenia</strong>
    <p>Właściciel połączenia musi ponownie połączyć konto Google. Wydarzenia z tego źródła są chwilowo niedostępne.</p>
    <p className="google-calendar-freshness-date">{dateLabel}</p>
  </aside>

  if (hasUnavailableSource) return <aside className="google-calendar-freshness google-calendar-freshness-warning" aria-live="polite">
    <strong>Brak dostępu do współdzielonego kalendarza Google</strong>
    <p>Właściciel połączenia może sprawdzić dostępność kalendarza w ustawieniach Google Calendar.</p>
    <p className="google-calendar-freshness-date">{dateLabel}</p>
  </aside>

  if (hasFailedSource) return <aside className="google-calendar-freshness google-calendar-freshness-warning" aria-live="polite">
    <strong>Import Google może być nieaktualny</strong>
    <p>{failureMessage(sources)}</p>
    <p className="google-calendar-freshness-date">{dateLabel}</p>
  </aside>

  if (hasRunningSource) return <aside className="google-calendar-freshness google-calendar-freshness-progress" aria-live="polite">
    <strong>Import Google w toku</strong>
    <p>{noSuccessfulImport ? 'Trwa pierwszy import udostępnionego kalendarza.' : 'Wydarzenia są odświeżane.'}</p>
    <p className="google-calendar-freshness-date">{dateLabel}</p>
  </aside>

  if (noSuccessfulImport) return <aside className="google-calendar-freshness google-calendar-freshness-progress" aria-live="polite">
    <strong>Udostępniony import Google nie został jeszcze ukończony</strong>
    <p>Właściciel połączenia może zaimportować kalendarz w ustawieniach Google Calendar.</p>
    <p className="google-calendar-freshness-date">{dateLabel}</p>
  </aside>

  return <aside className="google-calendar-freshness google-calendar-freshness-current" aria-live="polite">
    <strong>Wydarzenia Google</strong>
    <p>{dateLabel}</p>
  </aside>
}
