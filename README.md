# Arruda's Finance

Controle financeiro pessoal para acompanhar dívidas e parcelamentos — cartão, financiamento, empréstimo, o que for. Cadastre uma dívida, marque as parcelas como pagas conforme o mês passa, e acompanhe tudo num painel com métricas de verdade: comprometimento de renda, projeção dos próximos meses e um indicador de saúde financeira.

Feito para uso pessoal/familiar, 100% no navegador, com [Supabase](https://supabase.com) como backend (auth + banco de dados).

![status](https://img.shields.io/badge/status-em%20desenvolvimento-c8f060) ![stack](https://img.shields.io/badge/stack-HTML%20%2F%20CSS%20%2F%20JS-16161f)

---

## Índice

- [Funcionalidades](#funcionalidades)
- [Stack](#stack)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Como rodar localmente](#como-rodar-localmente)
- [Configurando o Supabase](#configurando-o-supabase)
- [Modelo de dados](#modelo-de-dados)
- [Roadmap](#roadmap)

---

## Funcionalidades

### Dívidas
- Cadastro de dívidas de duas formas: **por quantidade de meses** (informa o valor da parcela e quantos meses) ou **por valor total** (informa o valor total e quanto pretende pagar por mês — o app divide as parcelas automaticamente).
- Cada dívida vira uma aba, com um cronograma de parcelas em grade — clique numa parcela pra marcar como paga/pendente.
- Parcelas atrasadas (mês já passou e não foi paga) são destacadas visualmente.
- **Editar Dívida**: modal única pra editar título, valor original, data de início (desloca todas as parcelas mantendo valores e status) e o valor de qualquer parcela individual, sem precisar sair do fluxo.
- Adicionar parcela extra, excluir parcela específica, excluir a dívida inteira.
- Registro do valor original (pré-juros), com cálculo automático de juros/acréscimo.
- Aba "Quitadas" reúne as dívidas 100% pagas.

### Visão Geral (painel de decisão)
- **Saúde financeira**: selo 🟢 Saudável / 🟡 Atenção / 🔴 Crítico com base no % da renda comprometida.
- Comprometimento de renda: quanto das parcelas do mês representa em relação ao salário cadastrado.
- Sobra estimada do mês.
- Projeção dos próximos 6 meses, com marcador do salário e destaque nos meses que ultrapassam a renda.
- Previsão de quitação total (quando a última parcela de todas as dívidas será paga).
- Total geral, saldo restante, parcelas atrasadas e total pago no ano — somando todas as dívidas.

### Perfil
- Foto de perfil (redimensionada no navegador antes de salvar), telefone, profissão (lista com +150 opções) e salário mensal.
- Resumo financeiro pessoal reaproveitando os mesmos cálculos da Visão Geral.

### Conta
- Cadastro e login por e-mail/senha via Supabase Auth.
- Sessão persistente (recarregar a página mantém o usuário logado).

---

## Stack

- **HTML, CSS e JavaScript puros** — sem framework, sem build step, sem bundler.
- **[Supabase](https://supabase.com)** — autenticação e banco de dados Postgres, acessado via [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) (carregado por CDN).
- Fontes: [Syne](https://fonts.google.com/specimen/Syne) e [DM Mono](https://fonts.google.com/specimen/DM+Mono), via Google Fonts.

Não há dependências instaladas via npm — o `supabase-js` é importado direto no `index.html` por `<script>` tag.

---

## Estrutura do projeto

```
.
├── index.html      # markup: telas de login, app principal e todas as modais
├── style.css       # todo o estilo (tema escuro, responsivo, animações)
├── script.js       # toda a lógica: auth, CRUD de dívidas/parcelas/perfil, renderização
├── config.js       # credenciais do Supabase (URL + chave pública) — NÃO versionar com valores reais
└── .gitignore
```

Não há separação em módulos/bundler — `script.js` é um único arquivo organizado por seções (comentários `/* ── ... ── */` marcam cada bloco: helpers de cálculo, autenticação, dívidas, perfil, visão geral, modais).

---

## Como rodar localmente

Como o projeto não tem build step, basta servir os arquivos estáticos:

```bash
# qualquer servidor estático funciona, por exemplo:
npx serve .
# ou
python3 -m http.server 8000
```

Depois abra `http://localhost:PORT` no navegador. **Não abra o `index.html` direto como arquivo (`file://`)** — algumas chamadas do Supabase podem ter problemas de CORS/cookies nesse modo.

Antes de rodar, configure o `config.js` (veja a seção abaixo).

---

## Configurando o Supabase

1. Crie um projeto gratuito em [supabase.com](https://supabase.com).
2. Em **Project Settings → API**, copie a **URL** do projeto e a chave **publishable/anon**.
3. Edite `config.js`:

```js
const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_KEY = 'sua-chave-publishable-aqui';
```

   > A chave anon/publishable é segura para expor no front-end — o acesso aos dados é controlado por **Row Level Security (RLS)** no banco, não pela chave em si. Ainda assim, evite versionar `config.js` com valores reais num repositório público; prefira manter um `config.example.js` no repo e o `config.js` real fora do controle de versão.

4. Crie as tabelas descritas em [Modelo de dados](#modelo-de-dados) e habilite RLS com policies que restrinjam cada linha ao `user_id` do usuário autenticado (`auth.uid() = user_id`).
5. Em **Authentication → Providers**, deixe o login por e-mail/senha habilitado (é o único método usado pelo app).

---

## Modelo de dados

O app espera três tabelas no Postgres do Supabase:

### `dividas`
| coluna           | tipo        | observações                          |
|-------------------|-------------|---------------------------------------|
| `id`              | uuid (PK)   | gerado automaticamente                |
| `user_id`         | uuid        | dono da dívida (`auth.users.id`)      |
| `titulo`          | text        | nome da dívida                        |
| `valor_original`  | numeric     | opcional — valor antes dos juros      |
| `created_at`      | timestamptz | usado para ordenar as abas            |

### `parcelas`
| coluna       | tipo        | observações                                  |
|--------------|-------------|------------------------------------------------|
| `id`         | uuid (PK)   | gerado automaticamente                        |
| `divida_id`  | uuid        | FK para `dividas.id`                          |
| `mes`        | text        | nome do mês por extenso (ex: `"Janeiro"`)     |
| `ano`        | int         | ano da parcela                                |
| `valor`      | numeric     | valor da parcela                              |
| `paga`       | boolean     | status de pagamento                           |
| `pago_em`    | timestamptz | preenchido quando marcada como paga           |
| `ordem`      | int         | ordem de criação (desempate na ordenação)     |

### `perfis`
| coluna         | tipo    | observações                                   |
|----------------|---------|-------------------------------------------------|
| `user_id`      | uuid (PK) | referencia `auth.users.id`, chave única        |
| `telefone`     | text    | opcional                                        |
| `profissao`    | text    | opcional                                        |
| `salario`      | numeric | opcional — usado nos cálculos de saúde financeira |
| `foto_base64`  | text    | imagem redimensionada, salva como data URL      |

> O app faz `upsert` em `perfis` usando `onConflict: 'user_id'`, então cada usuário tem no máximo uma linha de perfil.

Recomenda-se habilitar **RLS** nas três tabelas com uma policy do tipo:

```sql
using (auth.uid() = user_id)
```

(em `parcelas`, a checagem precisa ser feita via join com `dividas.user_id`, já que a tabela não tem `user_id` direto.)

---

## Roadmap

Algumas ideias já mapeadas para próximas melhorias:

- Categorização de dívidas (cartão, financiamento, empréstimo etc.) com filtros.
- Exportação de relatórios (PDF/CSV).
- Notificações/lembretes de parcelas próximas do vencimento.
- Múltiplas moedas.

---

## Licença

Projeto de uso pessoal — sem licença de código aberto definida até o momento.
