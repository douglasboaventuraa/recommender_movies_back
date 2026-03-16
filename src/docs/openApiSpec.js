const baseOpenApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Recommender Movies API',
    version: '2.0.0',
    description: 'API de dados e recomendacao de filmes com arquitetura em src/controllers e src/workers.'
  },
  paths: {
    '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
    '/api/users': { get: { summary: 'List users', responses: { '200': { description: 'Users list' } } } },
    '/api/movies': { get: { summary: 'List movies', responses: { '200': { description: 'Movies list' } } } },
    '/api/interactions': {
      get: { summary: 'List interactions', responses: { '200': { description: 'Interactions list' } } },
      post: { summary: 'Create interaction', responses: { '201': { description: 'Created' } } }
    },
    '/api/recommendations/{userId}': { get: { summary: 'Get recommendations', responses: { '200': { description: 'Recommendations' } } } },
    '/api/recommendations/refresh/{userId}': { post: { summary: 'Persist recommendation snapshot', responses: { '201': { description: 'Snapshot created' } } } },
    '/api/recommendations/batches/{userId}': { get: { summary: 'Recommendation batches by user', responses: { '200': { description: 'Batches list' } } } },
    '/api/recommendations/batch/{batchId}': { get: { summary: 'Batch detail', responses: { '200': { description: 'Batch detail' } } } },
    '/api/train': { post: { summary: 'Train and activate model', responses: { '201': { description: 'Training done' } } } },
    '/api/train/runs': { get: { summary: 'List training runs', responses: { '200': { description: 'Runs list' } } } }
  }
};

export const buildOpenApiSpec = (serverUrl) => ({
  ...baseOpenApiSpec,
  servers: [{ url: serverUrl }]
});
