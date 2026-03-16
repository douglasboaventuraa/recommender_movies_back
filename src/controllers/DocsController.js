import { Router } from 'express';
import { buildOpenApiSpec } from '../docs/openApiSpec.js';

const getServerUrl = (req) => {
  const explicitUrl = process.env.PUBLIC_API_BASE_URL?.trim();
  if (explicitUrl) {
    return explicitUrl.replace(/\/$/, '');
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : (forwardedProto || req.protocol || 'http');
  const host = req.headers['x-forwarded-host'] || req.get('host');

  return `${protocol}://${host}`;
};

export class DocsController {
  static router() {
    const router = Router();

    router.get('/openapi.json', (req, res) => {
      res.json(buildOpenApiSpec(getServerUrl(req)));
    });

    router.get('/docs', (_req, res) => {
      res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Recommender Movies API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      #swagger-ui { max-width: 1200px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui'
      });
    </script>
  </body>
</html>`);
    });

    return router;
  }
}
