-- Starting balances are signed so an opening can represent an overdraft.
alter table public.finance_transactions
    drop constraint finance_transactions_kind_endpoints_valid,
    add constraint finance_transactions_kind_endpoints_valid check (
        (kind = 'income' and amount_minor > 0 and source_wallet_id is null
            and destination_wallet_id is not null and savings_effect = 'none')
        or (kind in ('expense', 'savings_expense') and amount_minor > 0
            and source_wallet_id is not null and destination_wallet_id is null
            and savings_effect = 'none')
        or (kind in ('refund', 'savings_refund') and amount_minor > 0
            and source_wallet_id is null and destination_wallet_id is not null
            and savings_effect = 'none')
        or (kind = 'transfer' and amount_minor > 0
            and source_wallet_id is not null and destination_wallet_id is not null
            and source_wallet_id <> destination_wallet_id)
        or (kind = 'opening' and source_wallet_id is null
            and destination_wallet_id is not null and savings_effect = 'none')
        or (kind = 'adjustment' and amount_minor <> 0 and source_wallet_id is null
            and destination_wallet_id is not null and savings_effect = 'none'
            and nullif(btrim(description), '') is not null)
    );
