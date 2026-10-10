import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthGate'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/ToastProvider'
import { createHouseholdInvitesApi, createHouseholdMembersApi } from './api'

const inviteLifetime = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function HouseholdPage() {
  const { profile } = useAuth()
  const showToast = useToast()
  const membersApi = createHouseholdMembersApi(profile.household_id)
  const invitesApi = createHouseholdInvitesApi()
  const members = useQuery({
    queryKey: ['members', profile.household_id],
    queryFn: ({ signal }) => membersApi.list(signal),
  })
  const invite = useMutation({
    mutationFn: () => invitesApi.create(),
    onSuccess: () => showToast({ kind: 'success', title: 'Utworzono kod zaproszenia' }),
    onError: error => showToast({ kind: 'error', title: 'Nie udało się utworzyć kodu zaproszenia', description: error.message, action: { label: 'Spróbuj ponownie', onClick: () => invite.mutate() } }),
  })

  async function copyCode() {
    if (!invite.data) return
    try {
      await navigator.clipboard.writeText(invite.data.token)
      showToast({ kind: 'success', title: 'Skopiowano kod zaproszenia' })
    } catch {
      showToast({ kind: 'error', title: 'Nie udało się skopiować kodu', description: 'Zaznacz i skopiuj kod ręcznie.', action: { label: 'Spróbuj ponownie', onClick: () => void copyCode() } })
    }
  }

  return (
    <>
      <PageHeader eyebrow="Przestrzeń domowa" title="Domownicy" description="Zaproś bliską osobę do wspólnych zadań i zakupów." />

      <section className="panel household-invite-panel" aria-labelledby="invite-heading">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="invite-heading">Zaproś domownika</h2>
            <p className="panel-kicker">Jednorazowy kod jest ważny przez 24 godziny.</p>
          </div>
          <button className="primary-button" type="button" onClick={() => invite.mutate()} disabled={invite.isPending}>
            {invite.isPending ? 'Tworzę kod…' : invite.data ? 'Utwórz nowy kod' : 'Utwórz kod'}
          </button>
        </div>

        {invite.data && <div className="household-invite-body">
          <p className="small-muted">Wyślij ten kod osobie, którą zapraszasz. Po zalogowaniu wpisze go podczas dołączania do domu.</p>
          <div className="invite-code-row">
            <code className="invite-code" aria-label="Kod zaproszenia">{invite.data.token}</code>
            <button className="button-quiet" type="button" onClick={() => void copyCode()}>Kopiuj kod</button>
          </div>
          <p className="task-meta">Kod wygasa: <strong>{inviteLifetime.format(new Date(invite.data.expiresAt))}</strong></p>
        </div>}
      </section>

      <section className="panel household-members-panel" aria-labelledby="members-heading">
        <div className="panel-head">
          <div>
            <h2 className="panel-title" id="members-heading">Domownicy</h2>
            <p className="panel-kicker">Osoby z dostępem do wspólnych danych.</p>
          </div>
          {members.data && <span className="shopping-count">{members.data.length}</span>}
        </div>
        {members.isPending && <p className="panel-message" role="status">Ładuję domowników…</p>}
        {members.isError && <div className="household-invite-body"><p className="error-message" role="alert">{members.error.message}</p><button className="button-quiet" type="button" disabled={members.isFetching} onClick={() => void members.refetch()}>{members.isFetching ? 'Ładuję…' : 'Spróbuj ponownie'}</button></div>}
        {members.data && (members.data.length > 0
          ? <ul className="household-member-list">{members.data.map(member => <li key={member.id} className="household-member-row"><span className="account-avatar" aria-hidden="true">{member.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase()).join('') || 'FH'}</span><span>{member.name}{member.id === profile.id && <span className="small-muted"> (Ty)</span>}</span></li>)}</ul>
          : <p className="panel-message">Nie znaleziono domowników.</p>)}
      </section>
    </>
  )
}
