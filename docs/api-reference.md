# API Reference

Base URL:
- `http://localhost:3000`

Swagger:
- UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

## Health

### GET /health
Retorna status da API.

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/health" \
--header "Accept: application/json"
```

## Users

### GET /api/users?page=1&limit=20
Lista paginada de usuarios.

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/api/users?page=1&limit=20" \
--header "Accept: application/json"
```

### GET /api/users/{id}
Busca detalhe de usuario por UUID ou `external_id`.

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/api/users/real-u-00001" \
--header "Accept: application/json"
```

### GET /api/users/{id}/interactions?page=1&limit=20
Busca interacoes do usuario (UUID ou `external_id`).

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/api/users/real-u-00001/interactions?page=1&limit=5" \
--header "Accept: application/json"
```

## Movies

### GET /api/movies?page=1&limit=20
Lista paginada de filmes.

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/api/movies?page=1&limit=10" \
--header "Accept: application/json"
```

### GET /api/movies/{id}
Busca detalhe de filme por UUID ou `external_id`.

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/api/movies/real-m-0001" \
--header "Accept: application/json"
```

## Interactions

### GET /api/interactions?page=1&limit=20&eventType=rating
Lista paginada de interacoes com filtros opcionais:
- `userId` (UUID ou external_id)
- `movieId` (UUID ou external_id)
- `eventType` (`watch_start`, `watch_complete`, `like`, `rating`, `skip`)

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/api/interactions?page=1&limit=5&eventType=rating" \
--header "Accept: application/json"
```

### POST /api/interactions
Cria uma nova interacao.

Payload minimo recomendado:
```json
{
  "userExternalId": "real-u-00001",
  "movieExternalId": "real-m-0001",
  "eventType": "rating",
  "eventValue": 4.5,
  "source": "postman_test"
}
```

Exemplo:
```bash
curl --location --request POST "http://localhost:3000/api/interactions" \
--header "Content-Type: application/json" \
--header "Accept: application/json" \
--data-raw "{\"userExternalId\":\"real-u-00001\",\"movieExternalId\":\"real-m-0001\",\"eventType\":\"rating\",\"eventValue\":4.5,\"source\":\"postman_test\"}"
```

## Recommendations

### GET /api/recommendations/{userId}?limit=10
Gera recomendacoes em tempo real (nao persistidas).

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/api/recommendations/real-u-00001?limit=5" \
--header "Accept: application/json"
```

### POST /api/recommendations/refresh/{userId}?limit=20
Gera e persiste snapshot em `recommendation_batches` e `recommendation_results`.

Exemplo:
```bash
curl --location --request POST "http://localhost:3000/api/recommendations/refresh/real-u-00001?limit=5" \
--header "Accept: application/json"
```

### GET /api/recommendations/batches/{userId}?limit=10
Lista historico de batches persistidos do usuario.

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/api/recommendations/batches/real-u-00001?limit=5" \
--header "Accept: application/json"
```

### GET /api/recommendations/batch/{batchId}
Retorna detalhe de um batch persistido.

Exemplo:
```bash
curl --location --request GET "http://localhost:3000/api/recommendations/batch/6e2d85e9-dd8f-4a96-92c7-bc36fe7f96ce" \
--header "Accept: application/json"
```

## Observacoes

- Porta oficial atual da API: `3000`.
- Sempre que alterar `api/server.js`, reinicie o processo Node em execucao.
- Para testar no Postman, pode importar os `curl` diretamente em `Import > Raw text`.
