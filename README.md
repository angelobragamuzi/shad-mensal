# Shad Manager Frontend

Frontend SaaS do Shad Manager em `Next.js + Tailwind`, integrado com Supabase Auth + Database.

## Requisitos

- Node 20+
- Projeto Supabase com a migration em `supabase/migrations/202602130001_shad-manager_init.sql` aplicada
- Para operação completa de cobrança, aplicar também `supabase/migrations/202602190001_shad-manager_cobranca-completa.sql`
- Para automação de e-mails, aplicar também `supabase/migrations/202602190003_shad-manager_email-automation-log.sql`
- Para opcao PIX salva e vinculo dinamico com e-mail, aplicar tambem `supabase/migrations/202602200001_shad-manager_pix-payment-option.sql`
- Usuario criado em `Authentication > Users`

## Variaveis de ambiente

1. Copie `.env.example` para `.env.local`.
2. Preencha:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
BILLING_EMAIL_FROM="Financeiro <financeiro@seudominio.com>"
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=uma_chave_forte_para_o_cron

# Opcional A: Resend
RESEND_API_KEY=...

# Opcional B: SMTP (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=seuemail@gmail.com
SMTP_PASS=sua_senha_de_app_16_caracteres
```

Esses valores ficam em `Supabase Dashboard > Project Settings > API`.
Para e-mail, use chave da Resend em `https://resend.com/api-keys`.
Para Gmail SMTP, use senha de app (não a senha normal da conta Google).
`SUPABASE_SERVICE_ROLE_KEY` também fica em `Supabase Dashboard > Project Settings > API`.

## Automação de e-mails (cobrança)

A rota `GET/POST /api/cobranca/email/auto` executa envio automático com as regras:

- 3 dias antes do vencimento
- no dia do vencimento
- após o vencimento: diariamente (1, 2, 3, ...)

Essa rota exige `Authorization: Bearer <CRON_SECRET>` (ou header `x-cron-secret`) e grava log em `invoice_email_dispatch_logs` para evitar reenvio duplicado de notificações já enviadas com sucesso.

Teste manual local:

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cobranca/email/auto
```

Se estiver em Vercel, `vercel.json` já agenda execução diária às `11:35 UTC` (`35 11 * * *`), equivalente a `08:35` no horário de Brasília (UTC-3).

## Rodar local

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Fluxo esperado

1. Acessar `/login`.
2. Login com email/senha do usuario criado no Supabase Auth.
3. Se for o primeiro acesso sem organizacao, criar em `/onboarding`.
4. Redirecionamento para `/dashboard`.
5. Tela `/clientes` lendo e gravando no banco:
   - listar clientes reais
   - criar novo cliente (ja cria primeira fatura)
   - marcar como pago (insere em `payments` e atualiza fatura via trigger)
6. Tela `/cobrancas` com operação de cobrança:
   - gerar cobranças recorrentes do mês
   - atualizar cobranças vencidas
   - disparar follow-up via WhatsApp com histórico em `collection_events`
7. Tela `/pix` dedicada para gera��o de QR Code PIX, salvamento de op��o de pagamento e v�nculo autom�tico com e-mail de cobran�a.

## Observacoes

- As rotas do painel checam sessao no client e redirecionam para `/login` sem autenticacao.
- A funcao RPC `get_dashboard_metrics` depende de membership em `organization_members`.
- Se login funcionar, mas dashboard retornar vazio, verifique se o usuario tem `organization_members.role = owner/admin/staff` na organizacao.
