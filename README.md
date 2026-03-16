# Recommender Movies (Simplified)

Backend de recomendacao de filmes com schema simplificado para demo e validacao rapida.

## 1) Setup rapido

```bash
npm install
docker compose up -d
```

Aplicar schema simplificado:

```bash
docker compose exec postgres psql -U postgres -d smartshop_recommender -f /docker-entrypoint-initdb.d/schema.sql
```

Carregar dataset pequeno (40 usuarios, 24 filmes, 1200 interacoes):

```bash
docker compose exec postgres psql -U postgres -d smartshop_recommender -f /docker-entrypoint-initdb.d/reset_small_demo.sql
```

Subir API (porta 8080):

```bash
npm start
```

## 2) Teste em 3 comandos

1. Treinar modelo:

```bash
curl -X POST "http://localhost:8080/api/train" \
  -H "Content-Type: application/json" \
  -d '{"modelName":"nn-genre-affinity","epochs":5,"batchSize":32}'
```

2. Ver ultimo treino:

```bash
curl "http://localhost:8080/api/train/runs?limit=1"
```

3. Ver recomendacoes:

```bash
curl "http://localhost:8080/api/recommendations/demo-u-0001?limit=5"
```

### PowerShell (Windows)

1. Treinar modelo:

```powershell
Invoke-RestMethod "http://localhost:8080/api/train" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"modelName":"nn-genre-affinity","epochs":5,"batchSize":32}' |
  ConvertTo-Json -Depth 8
```

2. Ver ultimo treino:

```powershell
Invoke-RestMethod "http://localhost:8080/api/train/runs?limit=1" |
  ConvertTo-Json -Depth 8
```

3. Ver recomendacoes:

```powershell
Invoke-RestMethod "http://localhost:8080/api/recommendations/demo-u-0001?limit=5" |
  ConvertTo-Json -Depth 8
```

## 3) Tabelas do schema atual

- countries
- languages
- genres
- users
- user_preferred_genres
- movies
- movie_genres
- interaction_events
- user_movie_feedback
- training_runs
- model_registry
- recommendation_batches
- recommendation_results

## 4) Scripts de banco

- `db/schema.sql`: schema simplificado oficial
- `db/reset_small_demo.sql`: reset e seed pequeno para demo
- `db/prune_to_core_tables.sql`: remove tabelas antigas nao usadas
