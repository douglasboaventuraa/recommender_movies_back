import express from 'express';
import cors from 'cors';

import { pool } from './config/db.js';
import { DocsController } from './controllers/DocsController.js';
import { HealthController } from './controllers/HealthController.js';
import { UsersController } from './controllers/UsersController.js';
import { MoviesController } from './controllers/MoviesController.js';
import { InteractionsController } from './controllers/InteractionsController.js';
import { RecommendationsController } from './controllers/RecommendationsController.js';
import { TrainingController } from './controllers/TrainingController.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use(DocsController.router());
app.use(HealthController.router({ pool }));
app.use(UsersController.router({ pool }));
app.use(MoviesController.router({ pool }));
app.use(InteractionsController.router({ pool }));
app.use(RecommendationsController.router({ pool }));
app.use(TrainingController.router({ pool }));

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
