-- Seed demo: cria 100 clientes com valores, telefones, status e vencimentos variados.
-- Execute no SQL Editor do Supabase.
-- Opcional: defina v_org_slug se quiser forcar uma organizacao especifica.

do $$
declare
  v_org_slug text := null; -- ex.: 'minha-organizacao'
  v_org_id uuid;
  v_created_by uuid;
  v_seed integer := (extract(epoch from clock_timestamp())::integer % 100000);

  i integer;
  v_student_id uuid;
  v_invoice_id uuid;
  v_due_day smallint;
  v_amount_cents integer;
  v_student_status public.student_status;
  v_cycle public.billing_cycle;
  v_due_date date;
  v_method public.payment_method;
  v_payment_cents integer;
  v_phone text;
begin
  if v_org_slug is not null then
    select o.id
      into v_org_id
      from public.organizations o
     where o.slug = lower(trim(v_org_slug))
     limit 1;
  else
    select o.id
      into v_org_id
      from public.organizations o
     order by o.created_at desc
     limit 1;
  end if;

  if v_org_id is null then
    raise exception 'Nenhuma organizacao encontrada. Crie uma organizacao antes de rodar o seed.';
  end if;

  select m.user_id
    into v_created_by
    from public.organization_members m
   where m.organization_id = v_org_id
   order by
     case m.role
       when 'owner' then 1
       when 'admin' then 2
       else 3
     end,
     m.created_at asc
   limit 1;

  for i in 1..100 loop
    v_due_day := (((i * 7) + v_seed) % 28 + 1)::smallint;
    v_amount_cents := 8900 + (((i * 1379) + v_seed) % 52000); -- R$ 89,00 a ~R$ 609,00

    v_student_status := case
      when i % 9 = 0 then 'inactive'::public.student_status
      else 'active'::public.student_status
    end;

    v_cycle := case
      when i % 3 = 0 then 'quarterly'::public.billing_cycle
      when i % 2 = 0 then 'weekly'::public.billing_cycle
      else 'monthly'::public.billing_cycle
    end;

    v_phone :=
      lpad((11 + ((i + v_seed) % 70))::text, 2, '0')
      || '9'
      || lpad((((v_seed * 100) + i) % 100000000)::text, 8, '0');

    insert into public.students (
      organization_id,
      full_name,
      phone,
      billing_cycle,
      amount_cents,
      due_day,
      status,
      notes,
      created_by
    )
    values (
      v_org_id,
      format('Cliente %s-%s', lpad(v_seed::text, 5, '0'), lpad(i::text, 3, '0')),
      v_phone,
      v_cycle,
      v_amount_cents,
      v_due_day,
      v_student_status,
      format('Seed automatico (%s)', v_seed),
      v_created_by
    )
    returning id into v_student_id;

    v_due_date := (date_trunc('month', current_date)::date + (v_due_day - 1));

    insert into public.invoices (
      organization_id,
      student_id,
      reference_period_start,
      reference_period_end,
      due_date,
      amount_cents,
      paid_amount_cents,
      status,
      created_by
    )
    values (
      v_org_id,
      v_student_id,
      date_trunc('month', current_date)::date,
      (date_trunc('month', current_date)::date + interval '1 month - 1 day')::date,
      v_due_date,
      v_amount_cents,
      0,
      'pending'::public.invoice_status,
      v_created_by
    )
    returning id into v_invoice_id;

    v_method := case (i % 5)
      when 0 then 'pix'::public.payment_method
      when 1 then 'card'::public.payment_method
      when 2 then 'cash'::public.payment_method
      when 3 then 'transfer'::public.payment_method
      else 'other'::public.payment_method
    end;

    -- Distribui cenario financeiro para variar status e comportamento:
    -- 0: atrasada sem pagamento
    -- 1: vence hoje pendente
    -- 2: vence em breve pendente
    -- 3: parcial e atrasada
    -- 4: paga integral
    -- 5: parcial em dia
    -- 6: cancelada
    -- 7: pendente futura
    case (i % 8)
      when 0 then
        update public.invoices
           set due_date = current_date - ((i % 20) + 2),
               status = 'overdue'::public.invoice_status
         where id = v_invoice_id;

      when 1 then
        update public.invoices
           set due_date = current_date,
               status = 'pending'::public.invoice_status
         where id = v_invoice_id;

      when 2 then
        update public.invoices
           set due_date = current_date + ((i % 7) + 1),
               status = 'pending'::public.invoice_status
         where id = v_invoice_id;

      when 3 then
        v_payment_cents := greatest(1000, round(v_amount_cents * 0.40)::integer);
        insert into public.payments (
          organization_id,
          invoice_id,
          student_id,
          amount_cents,
          method,
          paid_at,
          notes,
          created_by
        )
        values (
          v_org_id,
          v_invoice_id,
          v_student_id,
          v_payment_cents,
          v_method,
          now() - make_interval(days => ((i % 5) + 1), hours => ((i * 3) % 12)),
          'Seed: pagamento parcial',
          v_created_by
        );

        update public.invoices
           set due_date = current_date - ((i % 10) + 1),
               status = 'overdue'::public.invoice_status
         where id = v_invoice_id;

      when 4 then
        insert into public.payments (
          organization_id,
          invoice_id,
          student_id,
          amount_cents,
          method,
          paid_at,
          notes,
          created_by
        )
        values (
          v_org_id,
          v_invoice_id,
          v_student_id,
          v_amount_cents,
          v_method,
          now() - make_interval(days => (i % 15), hours => ((i * 5) % 18)),
          'Seed: pagamento integral',
          v_created_by
        );

      when 5 then
        v_payment_cents := greatest(1000, round(v_amount_cents * 0.55)::integer);
        insert into public.payments (
          organization_id,
          invoice_id,
          student_id,
          amount_cents,
          method,
          paid_at,
          notes,
          created_by
        )
        values (
          v_org_id,
          v_invoice_id,
          v_student_id,
          v_payment_cents,
          v_method,
          now() - make_interval(days => (i % 6), hours => ((i * 2) % 10)),
          'Seed: pagamento parcial em dia',
          v_created_by
        );

        update public.invoices
           set due_date = current_date + ((i % 6) + 1),
               status = 'partial'::public.invoice_status
         where id = v_invoice_id;

      when 6 then
        update public.invoices
           set status = 'canceled'::public.invoice_status,
               canceled_at = now(),
               due_date = current_date + ((i % 12) + 2)
         where id = v_invoice_id;

      else
        update public.invoices
           set due_date = current_date + ((i % 14) + 3),
               status = 'pending'::public.invoice_status
         where id = v_invoice_id;
    end case;
  end loop;

  raise notice 'Seed concluido: 100 clientes criados na organizacao % (seed=%).', v_org_id, v_seed;
end;
$$;

