# Integracao com Banco do Zero (PostgreSQL)

Este guia mostra o caminho completo para sair de `data/*.json` e usar banco real.

## 1. Pre-requisitos

- PostgreSQL 14+
- `psql` no PATH
- Node.js 20+

## 2. Criar banco

```sql
CREATE DATABASE smartshop_recommender;
```

Via terminal:

```bash
psql -U postgres -c "CREATE DATABASE smartshop_recommender;"
```

## 3. Aplicar schema e seed

No diretorio raiz do projeto (`SmartShop-Recommender`):

```bash
psql -U postgres -d smartshop_recommender -f db/schema.sql
psql -U postgres -d smartshop_recommender -f db/seed.sql
```

## 4. Validar dados

```bash
psql -U postgres -d smartshop_recommender -c "SELECT COUNT(*) FROM users;"
psql -U postgres -d smartshop_recommender -c "SELECT COUNT(*) FROM movies;"
psql -U postgres -d smartshop_recommender -c "SELECT COUNT(*) FROM interaction_events;"
```

## 5. Criar backend minimo (API)

A aplicacao atual e front-end. Para integrar com banco, crie uma API Node.js.

### 5.1 Dependencias

```bash
npm install express pg cors dotenv
```

### 5.2 Variaveis de ambiente (`.env`)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/smartshop_recommender
PORT=3001
```

### 5.3 Endpoints minimos esperados

- `GET /api/users`
- `GET /api/movies`
- `GET /api/users/:id/interactions`
- `POST /api/interactions`
- `GET /api/recommendations/:userId?limit=10`

## 6. Mapeamento do front atual

Substituicoes no front:

- Antes: `fetch('/data/users.json')`
- Depois: `fetch('http://localhost:3001/api/users')`

- Antes: `fetch('/data/products.json')`
- Depois: `fetch('http://localhost:3001/api/movies')`

No worker de treino:

- `products` vira `movies`
- `purchases` vira `interactions`
- `category` vira `genre`
- `color` pode virar `language` ou `tag`

## 7. Queries base para recomendacao

### 7.1 Itens interagidos por usuario

```sql
SELECT
  ie.user_id,
  ie.movie_id,
  SUM(ie.event_weight) AS interaction_score
FROM interaction_events ie
GROUP BY ie.user_id, ie.movie_id;
```

### 7.2 Filmes populares globais (fallback)

```sql
SELECT
  m.id,
  m.title,
  COALESCE(SUM(ie.event_weight), 0) AS popularity
FROM movies m
LEFT JOIN interaction_events ie ON ie.movie_id = m.id
GROUP BY m.id, m.title
ORDER BY popularity DESC
LIMIT 10;
```

## 8. Proximo passo recomendado

1. Criar pasta `api/` com servidor Express.
2. Implementar os 5 endpoints minimos.
3. Trocar `fetch` do front para API.
4. Atualizar worker para usar schema de filmes.
5. Versionar tudo em migracoes (fase 2 com Prisma/Knex/Drizzle).
