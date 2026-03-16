import { Router } from 'express';
import { parseLimit } from '../services/httpUtils.js';
import { ModelTrainingWorker } from '../workers/ModelTrainingWorker.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class TrainingController {
  static router({ pool }) {
    const router = Router();

    router.post('/api/train', async (req, res) => {
      const client = await pool.connect();
      let runId = null;
      try {
        const startedAt = new Date();
        const modelName = req.body?.modelName || 'nn-genre-affinity';
        const requestedVersion = req.body?.modelVersion;
        const generatedVersion = requestedVersion || `v-${Date.now()}`;

        const epochs = Math.min(200, Math.max(5, Number.parseInt(req.body?.epochs, 10) || 20));
        const batchSize = Math.min(256, Math.max(16, Number.parseInt(req.body?.batchSize, 10) || 64));
        const learningRateRaw = Number(req.body?.learningRate);
        const learningRate = Number.isFinite(learningRateRaw) ? clamp(learningRateRaw, 0.0001, 0.1) : 0.005;
        const validationSplitRaw = Number(req.body?.validationSplit);
        const validationSplit = Number.isFinite(validationSplitRaw) ? clamp(validationSplitRaw, 0.1, 0.4) : 0.2;
        const maxUsers = Math.min(300, Math.max(1, Number.parseInt(req.body?.maxUsers, 10) || 7));
        const maxMovies = Math.min(500, Math.max(6, Number.parseInt(req.body?.maxMovies, 10) || 30));
        const maxGenres = Math.min(12, Math.max(1, Number.parseInt(req.body?.maxGenres, 10) || 6));

        const runInsert = await client.query(
          `
            INSERT INTO training_runs (
              run_name,
              algorithm,
              model_version,
              status,
              parameters,
              started_at,
              metrics
            )
            VALUES ($1, $2, $3, 'running', $4::jsonb, $5, '{}'::jsonb)
            RETURNING id
          `,
          [
            `${modelName}-${generatedVersion}`,
            'tfjs-dense-binary-classifier',
            generatedVersion,
            JSON.stringify({
              epochs,
              batchSize,
              learningRate,
              validationSplit,
              maxUsers,
              maxMovies,
              maxGenres,
              encoder: 'worker-inspired-user-movie-concat-v1'
            }),
            startedAt.toISOString()
          ]
        );

        runId = runInsert.rows[0].id;

        const trained = await ModelTrainingWorker.train({
          client,
          modelName,
          modelVersion: generatedVersion,
          epochs,
          batchSize,
          learningRate,
          validationSplit,
          maxUsers,
          maxMovies,
          maxGenres
        });

        await client.query('BEGIN');

        const runUpdate = await client.query(
          `
            UPDATE training_runs
            SET
              status = 'completed',
              metrics = $2::jsonb,
              ended_at = $3
            WHERE id = $1
            RETURNING id, run_name, algorithm, model_version, status, started_at, ended_at, metrics
          `,
          [runId, JSON.stringify(trained.metrics), new Date().toISOString()]
        );

        await client.query(
          `
            UPDATE model_registry
            SET is_active = FALSE
            WHERE model_name = $1
          `,
          [modelName]
        );

        const modelInsert = await client.query(
          `
            INSERT INTO model_registry (
              training_run_id,
              model_name,
              model_version,
              storage_uri,
              is_active
            )
            VALUES ($1, $2, $3, $4, TRUE)
            RETURNING id, model_name, model_version, storage_uri, is_active, created_at
          `,
          [runId, modelName, generatedVersion, trained.artifactPath]
        );

        await client.query('COMMIT');

        res.status(201).json({
          message: 'Training run executed successfully',
          run: runUpdate.rows[0],
          model: modelInsert.rows[0]
        });
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {
          // Ignore rollback errors.
        }

        if (runId) {
          try {
            await client.query(
              `
                UPDATE training_runs
                SET status = 'failed', ended_at = NOW(), metrics = jsonb_set(metrics, '{error}', to_jsonb($2::text), true)
                WHERE id = $1
              `,
              [runId, error.message]
            );
          } catch (_) {
            // Ignore status update failures.
          }
        }

        res.status(500).json({ error: 'Failed to execute training run', details: error.message });
      } finally {
        client.release();
      }
    });

    router.get('/api/train/runs', async (req, res) => {
      try {
        const limit = parseLimit(req.query.limit, { min: 1, max: 50, defaultValue: 10 });

        const result = await pool.query(
          `
            SELECT
              tr.id,
              tr.run_name,
              tr.algorithm,
              tr.model_version,
              tr.status,
              tr.metrics,
              tr.started_at,
              tr.ended_at,
              mr.id AS model_id,
              mr.model_name,
              mr.is_active
            FROM training_runs tr
            LEFT JOIN model_registry mr ON mr.training_run_id = tr.id
            ORDER BY tr.created_at DESC
            LIMIT $1
          `,
          [limit]
        );

        res.json({ data: result.rows, limit });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch training runs', details: error.message });
      }
    });

    return router;
  }
}
