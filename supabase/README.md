# Supabase setup for Shad Manager

## 1) Apply the migration

### Option A: Supabase SQL Editor
1. Open your Supabase project.
2. Go to `SQL Editor`.
3. Paste the file `supabase/migrations/202602130001_shad-manager_init.sql`.
4. Run.

### Option B: Supabase CLI
```bash
supabase db push
```

## 2) Create your first organization (owner)

Run while authenticated as the first admin user:
```sql
select public.create_organization('ShadSolutions', 'shadsolutions');
```

## 3) Dashboard metrics RPC test

Replace `<ORG_ID>` with the UUID returned in step 2:
```sql
select * from public.get_dashboard_metrics('<ORG_ID>'::uuid);
```

## 4) Daily overdue automation (optional)

You can run manually for one org:
```sql
select public.mark_overdue_invoices('<ORG_ID>'::uuid);
```

For all organizations, call with service role (recommended via scheduled job):
```sql
select public.mark_overdue_invoices(null);
```

## 5) Geração recorrente de cobranças (mensal)

Para gerar cobranças do mês de uma organização:
```sql
select * from public.generate_invoices_for_period('<ORG_ID>'::uuid, current_date);
```

## 6) Histórico de contatos de cobrança

A tabela `public.collection_events` registra disparos e ações de follow-up.
- O frontend usa `public.log_collection_event(...)` para registrar cobranças via WhatsApp.
- RLS habilitado por organização.

## 7) Frontend data mapping notes

- `students.amount_cents` -> monthly fee value in cents.
- `invoices.status` values:
  - `pending`
  - `partial`
  - `paid`
  - `overdue`
  - `canceled`
- `payments` insert automatically updates invoice paid totals/status via trigger.
