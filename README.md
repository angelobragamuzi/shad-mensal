# Shad Manager Frontend

Frontend SaaS do Shad Manager em `Next.js + Tailwind`, integrado com Supabase Auth + Database.

## Requisitos

- Node 20+
- Projeto Supabase com a migration em `supabase/migrations/202602130001_shad-manager_init.sql` aplicada
- Usuario criado em `Authentication > Users`

## Variaveis de ambiente

1. Copie `.env.example` para `.env.local`.
2. Preencha:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Esses valores ficam em `Supabase Dashboard > Project Settings > API`.

## Rodar local

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Fluxo esperado

1. Acessar `/login`.
2. Login com email/senha do usuario criado no Supabase Auth.
3. Redirecionamento para `/dashboard`.
4. Tela `/clientes` lendo e gravando no banco:
   - listar clientes reais
   - criar novo cliente (ja cria primeira fatura)
   - marcar como pago (insere em `payments` e atualiza fatura via trigger)

## Observacoes

- As rotas do painel checam sessao no client e redirecionam para `/login` sem autenticacao.
- A funcao RPC `get_dashboard_metrics` depende de membership em `organization_members`.
- Se login funcionar, mas dashboard retornar vazio, verifique se o usuario tem `organization_members.role = owner/admin/staff` na organizacao.
