-- Shad Manager - Purge operational data by organization

begin;

create or replace function public.purge_organization_operational_data(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_rel regclass;
  v_pending text[] := array[
    'collection_events',
    'bank_reconciliations',
    'bank_statement_transactions',
    'bank_statement_imports',
    'service_invoice_items',
    'service_invoices',
    'quote_items',
    'quotes',
    'payable_payments',
    'accounts_payable',
    'cash_movements',
    'cash_accounts',
    'suppliers',
    'finance_categories',
    'payments',
    'invoices',
    'students'
  ];
  v_retry_count integer := 0;
  v_deleted_any boolean;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;

  if not public.has_org_role(p_org_id, array['owner','admin']::public.app_role[]) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  while coalesce(array_length(v_pending, 1), 0) > 0 loop
    v_retry_count := v_retry_count + 1;
    v_deleted_any := false;

    for i in 1..array_length(v_pending, 1) loop
      v_table := v_pending[i];
      if v_table is null then
        continue;
      end if;

      v_rel := to_regclass(format('public.%I', v_table));
      if v_rel is null then
        v_pending[i] := null;
        continue;
      end if;

      if not exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = v_table
          and c.column_name = 'organization_id'
      ) then
        v_pending[i] := null;
        continue;
      end if;

      begin
        execute format('delete from %s where organization_id = $1', v_rel)
        using p_org_id;
        v_pending[i] := null;
        v_deleted_any := true;
      exception
        when foreign_key_violation then
          null;
      end;
    end loop;

    v_pending := array_remove(v_pending, null);

    if coalesce(array_length(v_pending, 1), 0) = 0 then
      exit;
    end if;

    if not v_deleted_any or v_retry_count > 16 then
      raise exception
        'unable to purge organization data due to foreign key dependencies in tables: %',
        array_to_string(v_pending, ', ')
      using errcode = '23503';
    end if;
  end loop;
end;
$$;

revoke all on function public.purge_organization_operational_data(uuid) from public;
grant execute on function public.purge_organization_operational_data(uuid)
  to authenticated, service_role;

commit;
