-- Seed demo: cria 20 clientes com dados ficticios.
-- Execute no SQL Editor do Supabase.
-- Opcional: defina v_org_slug, v_user_email ou v_user_id antes de rodar.

do $$
declare
  v_org_slug text := null; -- ex.: 'minha-organizacao'
  v_user_email text := null; -- ex.: 'admin@empresa.com'
  v_user_id uuid := null; -- opcional: define diretamente o usuario
  v_org_id uuid;
  v_created_by uuid;
  v_seed integer := (extract(epoch from clock_timestamp())::integer % 100000);

  v_first_names text[] := array[
    'Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda',
    'Fabio', 'Gabriela', 'Hugo', 'Isabela', 'Joao',
    'Karen', 'Lucas', 'Mariana', 'Nicolas', 'Olivia',
    'Paulo', 'Renata', 'Samuel', 'Tainara', 'Vinicius'
  ];

  v_last_names text[] := array[
    'Silva', 'Souza', 'Costa', 'Oliveira', 'Pereira',
    'Rodrigues', 'Almeida', 'Nascimento', 'Lima', 'Araujo',
    'Ferreira', 'Martins', 'Gomes', 'Ribeiro', 'Barreto'
  ];

  i integer;
  v_full_name text;
  v_phone text;
  v_email text;
  v_postal text;
  v_number text;
  v_cycle public.billing_cycle;
  v_amount_cents integer;
  v_due_day smallint;
  v_status public.student_status;
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

  if v_user_id is not null then
    v_created_by := v_user_id;
  elsif v_user_email is not null then
    select u.id
      into v_created_by
      from auth.users u
     where lower(u.email) = lower(trim(v_user_email))
     limit 1;
  else
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
  end if;

  if v_created_by is null then
    raise exception 'Nenhum usuario encontrado. Informe v_user_email ou v_user_id antes de rodar o seed.';
  end if;

  for i in 1..20 loop
    v_full_name :=
      v_first_names[(i % array_length(v_first_names, 1)) + 1]
      || ' '
      || v_last_names[((i * 3) % array_length(v_last_names, 1)) + 1];

    v_phone :=
      lpad((11 + ((i + v_seed) % 70))::text, 2, '0')
      || '9'
      || lpad((((v_seed * 10) + i) % 100000000)::text, 8, '0');

    v_email :=
      lower(replace(v_full_name, ' ', '.'))
      || lpad((v_seed % 99)::text, 2, '0')
      || lpad(i::text, 2, '0')
      || '@demo.local';

    v_postal := lpad((10000 + ((i * 73 + v_seed) % 89999))::text, 5, '0')
      || lpad((((i * 91) + v_seed) % 999)::text, 3, '0');
    v_number := (10 + (i * 7))::text;

    v_due_day := (((i * 5) + v_seed) % 28 + 1)::smallint;
    v_amount_cents := 8900 + (((i * 131) + v_seed) % 32000); -- R$ 89,00 a ~R$ 409,00
    v_cycle := case
      when i % 3 = 0 then 'quarterly'::public.billing_cycle
      when i % 2 = 0 then 'weekly'::public.billing_cycle
      else 'monthly'::public.billing_cycle
    end;
    v_status := case
      when i % 10 = 0 then 'inactive'::public.student_status
      else 'active'::public.student_status
    end;

    insert into public.students (
      organization_id,
      full_name,
      phone,
      email,
      postal_code,
      address_number,
      billing_cycle,
      amount_cents,
      due_day,
      status,
      notes,
      created_by
    )
    values (
      v_org_id,
      v_full_name,
      v_phone,
      v_email,
      v_postal,
      v_number,
      v_cycle,
      v_amount_cents,
      v_due_day,
      v_status,
      format('Seed automatico (%s)', v_seed),
      v_created_by
    );
  end loop;
end;
$$;
