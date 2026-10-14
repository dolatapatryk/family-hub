-- Release 1 finance dates use the Warsaw business calendar, including while UTC
-- is still on the preceding day. Keep this local to wallet RPCs: do not change
-- the database/session timezone, stored timestamps, permissions or search paths.
do $migration$
begin
alter function public.finance_list_wallets(uuid, text, date)
    set timezone = 'Europe/Warsaw';
alter function public.finance_save_wallet(uuid, uuid, uuid, bigint, text, text, text, date, bigint, text, text)
    set timezone = 'Europe/Warsaw';
alter function public.finance_set_wallet_archived(uuid, uuid, uuid, bigint, boolean)
    set timezone = 'Europe/Warsaw';
alter function public.finance_preview_wallet_balance(uuid, uuid, date)
    set timezone = 'Europe/Warsaw';
alter function public.finance_correct_wallet_balance(uuid, uuid, uuid, bigint, text, date, bigint, text)
    set timezone = 'Europe/Warsaw';
alter function public.finance_save_wallet_transaction(uuid, uuid, uuid, bigint, text, date, bigint, uuid, uuid, uuid, text, text)
    set timezone = 'Europe/Warsaw';
alter function public.finance_correct_wallet_opening(uuid, uuid, uuid, bigint, text, date, bigint)
    set timezone = 'Europe/Warsaw';
end;
$migration$;
