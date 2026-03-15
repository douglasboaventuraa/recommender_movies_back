# Handoff Para Novo Repositorio

Este arquivo consolida o que ja foi definido para migrar o projeto para um novo repositorio focado em recomendacao de filmes com banco de dados.

## Objetivo
Criar um novo repositorio com:
- API conectada ao PostgreSQL
- Modelo de recomendacao de filmes por usuario
- Persistencia de usuarios, filmes e interacoes

## Arquivos Ja Criados Neste Repositorio
- `docs/especificacao-recomendacao-filmes.md`
- `db/schema.sql`
- `db/seed.sql`
- `docs/integracao-banco-do-zero.md`

## O Que Copiar Para o Novo Repositorio
Copiar estes arquivos como base inicial:
- `db/schema.sql`
- `db/seed.sql`
- `docs/especificacao-recomendacao-filmes.md`
- `docs/integracao-banco-do-zero.md`
- `docs/handoff-novo-repositorio-recomendacao-filmes.md`

## Resumo Tecnico (MVP)
- Banco: PostgreSQL
- Backend: Node.js + Express + pg
- Front: consumo via `fetch` em endpoints `/api/*`
- Recomendacao: score por usuario-filme com base em interacoes

## Modelo de Dados (Resumo)
Tabelas centrais:
- `users`
- `movies`
- `interaction_events`
- `user_movie_feedback`

Tabelas de apoio:
- `genres`, `movie_genres`, `languages`, `countries`
- `training_runs`, `training_samples`, `model_registry`
- `recommendation_batches`, `recommendation_results`

## Endpoints Planejados
- `GET /api/users`
- `GET /api/movies`
- `GET /api/users/:id/interactions`
- `POST /api/interactions`
- `GET /api/recommendations/:userId?limit=10`

## Setup Rapido do Banco
```bash
psql -U postgres -c "CREATE DATABASE smartshop_recommender;"
psql -U postgres -d smartshop_recommender -f db/schema.sql
psql -U postgres -d smartshop_recommender -f db/seed.sql
```

## Validacao Minima
```bash
psql -U postgres -d smartshop_recommender -c "SELECT COUNT(*) FROM users;"
psql -U postgres -d smartshop_recommender -c "SELECT COUNT(*) FROM movies;"
psql -U postgres -d smartshop_recommender -c "SELECT COUNT(*) FROM interaction_events;"
```

## Roadmap Inicial No Novo Repo
1. Criar pasta `api/` e servidor Express.
2. Configurar conexao com PostgreSQL via `DATABASE_URL`.
3. Implementar endpoints minimos.
4. Conectar front-end aos endpoints (substituir `data/*.json`).
5. Ajustar worker para dominio de filmes.
6. Gerar recomendacoes top N por usuario.

## Observacao
Este arquivo existe para servir como ponto unico de transferencia para o novo repositorio.
