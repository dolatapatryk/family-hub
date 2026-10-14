-- Cover references used for owner and creator removal checks, while preserving
-- the household visibility index used by wallet listing.
create index finance_wallets_created_by_idx
    on public.finance_wallets (created_by);
create index finance_wallets_owner_user_id_idx
    on public.finance_wallets (owner_user_id);
create index finance_wallets_household_owner_idx
    on public.finance_wallets (household_id, owner_user_id);
create index finance_transactions_created_by_idx
    on public.finance_transactions (created_by);
