# Especificacao Funcional e Tecnica

## Projeto
Sistema de recomendacao de filmes para usuarios, evoluindo o projeto atual de recomendacao de produtos.

## Contexto Atual
Hoje o projeto usa arquivos locais em `data/`:
- `data/users.json`: usuarios com `id`, `name`, `age` e historico em `purchases`.
- `data/products.json`: itens com `id`, `name`, `category`, `price`, `color`.

O worker `src/workers/modelTrainingWorker.js` transforma usuario/item em vetores e treina um modelo TensorFlow.js no browser.

## Objetivo da Evolucao
Substituir a origem de dados local por banco de dados e adaptar o dominio de e-commerce para filmes.

## Escopo (MVP)
- Integrar leitura de usuarios e filmes via API conectada ao banco.
- Registrar interacoes de usuario com filmes (assistiu, curtiu, nota).
- Treinar modelo de recomendacao com base nessas interacoes.
- Exibir ranking de filmes recomendados por usuario.

## Fora de Escopo (MVP)
- Recomendacao em tempo real com streaming.
- Treinamento distribuido no servidor.
- Features sociais (seguidores, comentarios).

## Requisitos Funcionais
1. O sistema deve listar usuarios e filmes a partir do banco.
2. O sistema deve registrar eventos de interacao:
   - `watch`
   - `like`
   - `rating` (1 a 5)
3. O sistema deve treinar um modelo usando historico de interacoes.
4. O sistema deve recomendar os top N filmes para um usuario.
5. O sistema deve evitar recomendar itens ja assistidos (configuravel).

## Requisitos Nao Funcionais
- Latencia de recomendacao: ate 500 ms para top 10 no cliente.
- Disponibilidade da API: 99% no ambiente de desenvolvimento compartilhado.
- Auditoria basica: guardar data/hora das interacoes.
- Privacidade: nao expor dados sensiveis de usuario no front.

## Modelo de Dados Proposto

### users
- `id` (PK)
- `name`
- `age`
- `created_at`

### movies
- `id` (PK)
- `title`
- `genre`
- `release_year`
- `duration_min`
- `language`
- `avg_rating` (opcional)
- `created_at`

### user_movie_interactions
- `id` (PK)
- `user_id` (FK users.id)
- `movie_id` (FK movies.id)
- `event_type` (`watch`, `like`, `rating`)
- `rating_value` (nullable, 1..5)
- `event_weight` (exemplo: watch=1, like=2, rating=valor)
- `created_at`

## Mapeamento do Dominio Atual -> Novo Dominio
- `products` -> `movies`
- `category` -> `genre`
- `price` -> `duration_min` (ou remover da feature se nao fizer sentido)
- `color` -> `language` (ou outro atributo categorico de conteudo)
- `purchases` -> `interactions`

## Integracao com Banco (Arquitetura)

### Opcao recomendada
- Backend Node.js com API REST.
- Banco relacional (PostgreSQL).
- Front-end continua consumindo via `fetch`.

### Endpoints iniciais
- `GET /api/users`
- `GET /api/movies`
- `GET /api/users/:id/interactions`
- `POST /api/interactions`
- `GET /api/recommendations/:userId?limit=10`

## Estrategia de Recomendacao (MVP)
1. Gerar vetor de filme com features numericas e categoricas (genre/language).
2. Gerar vetor de usuario a partir da media ponderada dos filmes interagidos.
3. Criar pares usuario-filme com rotulo binario (interagiu = 1, nao interagiu = 0).
4. Treinar rede neural densa (TensorFlow.js) com saida sigmoide.
5. Ordenar score de predicao e retornar top N.

## Regras de Negocio
- Interacoes com nota alta devem ter maior peso no treinamento.
- Interacoes antigas podem ter decaimento temporal (fase 2).
- Usuario sem historico recebe fallback por popularidade/genre global.

## Plano de Migracao
1. Criar schema no banco (`users`, `movies`, `user_movie_interactions`).
2. Criar script de carga inicial (seed).
3. Criar camada de servico no backend para leitura/escrita.
4. Alterar front para consumir API em vez de `data/*.json`.
5. Adaptar `modelTrainingWorker.js` para novo esquema de features.
6. Validar qualidade da recomendacao com conjunto de teste simples.

## Criterios de Aceite
- Usuario consegue abrir tela com filmes vindos do banco.
- Nova interacao e persistida no banco e refletida em nova recomendacao.
- Endpoint de recomendacao retorna lista ordenada com score.
- Fluxo completo funciona sem depender de arquivos locais em `data/`.

## Riscos e Mitigacoes
- Poucos dados para treino:
  - Mitigacao: popularidade + baseline por genero.
- Sobreajuste com dataset pequeno:
  - Mitigacao: reduzir complexidade do modelo e usar validacao.
- Inconsistencia entre front e schema:
  - Mitigacao: contratos de API com validacao (zod/joi).

## Entregaveis
- Documento de especificacao (este arquivo).
- Schema SQL inicial.
- Endpoints REST de usuarios, filmes, interacoes e recomendacoes.
- Worker atualizado para dominio de filmes.
