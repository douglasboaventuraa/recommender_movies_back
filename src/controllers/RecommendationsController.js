import { Router } from 'express';
import { parseLimit } from '../services/httpUtils.js';
import { findUserByIdOrExternalId } from '../services/identityService.js';
import { generateRecommendations } from '../services/recommendationService.js';
import { generateModelRecommendations } from '../services/modelInferenceService.js';

export class RecommendationsController {
  static router({ pool }) {
    const router = Router();

    router.get('/api/recommendations/:userId', async (req, res) => {
      try {
        const limit = parseLimit(req.query.limit, { min: 1, max: 50, defaultValue: 10 });
        const user = await findUserByIdOrExternalId(pool, req.params.userId);

        if (!user) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        let recommendations = [];
        let strategy = 'baseline_genre_affinity_v1';
        let model = null;

        try {
          const modelResult = await generateModelRecommendations({ client: pool, user, limit });
          if (modelResult) {
            recommendations = modelResult.recommendations;
            strategy = modelResult.strategy;
            model = modelResult.model;
          } else {
            recommendations = await generateRecommendations(pool, user.id, limit);
          }
        } catch (_) {
          recommendations = await generateRecommendations(pool, user.id, limit);
        }

        res.json({ user, limit, count: recommendations.length, strategy, model, recommendations });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch recommendations', details: error.message });
      }
    });

    router.post('/api/recommendations/refresh/:userId', async (req, res) => {
      const client = await pool.connect();
      try {
        const limit = parseLimit(req.query.limit, { min: 1, max: 100, defaultValue: 20 });

        const user = await findUserByIdOrExternalId(client, req.params.userId);
        if (!user) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        let recommendations = [];
        let strategy = 'baseline_genre_affinity_v1';
        let model = null;

        try {
          const modelResult = await generateModelRecommendations({ client, user, limit });
          if (modelResult) {
            recommendations = modelResult.recommendations;
            strategy = modelResult.strategy;
            model = modelResult.model;
          } else {
            recommendations = await generateRecommendations(client, user.id, limit);
          }
        } catch (_) {
          recommendations = await generateRecommendations(client, user.id, limit);
        }

        await client.query('BEGIN');

        const batchResult = await client.query(
          `
            INSERT INTO recommendation_batches (model_id, generated_at, generation_mode, source, metadata)
            VALUES ($1, NOW(), 'on_demand', 'api', $2::jsonb)
            RETURNING id, generated_at
          `,
          [
            model?.id || null,
            JSON.stringify({
              userId: user.id,
              userExternalId: user.external_id,
              limit,
              strategy,
              modelName: model?.model_name || null,
              modelVersion: model?.model_version || null
            })
          ]
        );

        const batch = batchResult.rows[0];

        for (let i = 0; i < recommendations.length; i += 1) {
          const item = recommendations[i];
          await client.query(
            `
              INSERT INTO recommendation_results (
                batch_id,
                user_id,
                movie_id,
                rank_position,
                score,
                reason
              )
              VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `,
            [
              batch.id,
              user.id,
              item.id,
              i + 1,
              item.score,
              JSON.stringify({
                genres: item.genres,
                popularityScore: item.popularity_score,
                strategy,
                modelName: model?.model_name || null,
                modelVersion: model?.model_version || null
              })
            ]
          );
        }

        await client.query('COMMIT');

        res.status(201).json({
          message: 'Recommendation snapshot generated',
          user,
          strategy,
          model,
          batch: { id: batch.id, generated_at: batch.generated_at, count: recommendations.length },
          recommendations
        });
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {
          // Ignore rollback errors.
        }
        res.status(500).json({ error: 'Failed to refresh recommendations', details: error.message });
      } finally {
        client.release();
      }
    });

    router.get('/api/recommendations/batches/:userId', async (req, res) => {
      try {
        const limit = parseLimit(req.query.limit, { min: 1, max: 50, defaultValue: 10 });
        const user = await findUserByIdOrExternalId(pool, req.params.userId);

        if (!user) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        const batchesResult = await pool.query(
          `
            SELECT
              rb.id,
              rb.generated_at,
              rb.generation_mode,
              rb.source,
              COUNT(rr.id)::int AS results_count,
              MAX(rr.score) AS best_score
            FROM recommendation_batches rb
            JOIN recommendation_results rr ON rr.batch_id = rb.id
            WHERE rr.user_id = $1
            GROUP BY rb.id
            ORDER BY rb.generated_at DESC
            LIMIT $2
          `,
          [user.id, limit]
        );

        res.json({ user, data: batchesResult.rows });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch recommendation batches', details: error.message });
      }
    });

    router.get('/api/recommendations/batch/:batchId', async (req, res) => {
      try {
        const batchResult = await pool.query(
          `
            SELECT id, generated_at, generation_mode, source, metadata
            FROM recommendation_batches
            WHERE id::text = $1
            LIMIT 1
          `,
          [req.params.batchId]
        );

        if (!batchResult.rowCount) {
          res.status(404).json({ error: 'Batch not found' });
          return;
        }

        const itemsResult = await pool.query(
          `
            SELECT
              rr.rank_position,
              rr.score,
              rr.reason,
              rr.user_id,
              u.external_id AS user_external_id,
              u.full_name AS user_name,
              rr.movie_id,
              m.external_id AS movie_external_id,
              m.title AS movie_title
            FROM recommendation_results rr
            JOIN users u ON u.id = rr.user_id
            JOIN movies m ON m.id = rr.movie_id
            WHERE rr.batch_id = $1
            ORDER BY rr.rank_position
          `,
          [batchResult.rows[0].id]
        );

        res.json({ batch: batchResult.rows[0], count: itemsResult.rowCount, data: itemsResult.rows });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch recommendation batch', details: error.message });
      }
    });

    return router;
  }
}
