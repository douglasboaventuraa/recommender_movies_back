import { Router } from 'express';
import { parseLimit, parsePage, toOffset } from '../services/httpUtils.js';
import { findMovieByIdOrExternalId, findUserByIdOrExternalId } from '../services/identityService.js';

export class InteractionsController {
  static router({ pool }) {
    const router = Router();

    router.get('/api/interactions', async (req, res) => {
      try {
        const page = parsePage(req.query.page);
        const limit = parseLimit(req.query.limit, { defaultValue: 20, max: 100 });
        const offset = toOffset(page, limit);

        const where = [];
        const values = [];
        let idx = 1;

        if (req.query.userId) {
          where.push(`(u.id::text = $${idx} OR u.external_id = $${idx})`);
          values.push(req.query.userId);
          idx += 1;
        }

        if (req.query.movieId) {
          where.push(`(m.id::text = $${idx} OR m.external_id = $${idx})`);
          values.push(req.query.movieId);
          idx += 1;
        }

        if (req.query.eventType) {
          where.push(`ie.event_type = $${idx}`);
          values.push(req.query.eventType);
          idx += 1;
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const totalResult = await pool.query(
          `
            SELECT COUNT(*)::int AS total
            FROM interaction_events ie
            JOIN users u ON u.id = ie.user_id
            JOIN movies m ON m.id = ie.movie_id
            ${whereClause}
          `,
          values
        );

        const total = totalResult.rows[0]?.total || 0;

        const query = `
          SELECT
            ie.id,
            ie.event_type,
            ie.event_value,
            ie.event_weight,
            ie.source,
            ie.occurred_at,
            u.id AS user_id,
            u.external_id AS user_external_id,
            u.full_name AS user_name,
            m.id AS movie_id,
            m.external_id AS movie_external_id,
            m.title AS movie_title
          FROM interaction_events ie
          JOIN users u ON u.id = ie.user_id
          JOIN movies m ON m.id = ie.movie_id
          ${whereClause}
          ORDER BY ie.occurred_at DESC
          LIMIT $${idx} OFFSET $${idx + 1}
        `;

        const dataValues = [...values, limit, offset];
        const result = await pool.query(query, dataValues);

        res.json({
          data: result.rows,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch interactions', details: error.message });
      }
    });

    router.post('/api/interactions', async (req, res) => {
      try {
        const {
          userId,
          userExternalId,
          movieId,
          movieExternalId,
          eventType,
          eventValue = null,
          source = 'api',
          occurredAt = null
        } = req.body || {};

        const allowedEvents = new Set(['watch_start', 'watch_complete', 'like', 'rating', 'skip']);
        if (!allowedEvents.has(eventType)) {
          res.status(400).json({ error: 'Invalid eventType', allowed: Array.from(allowedEvents) });
          return;
        }

        let normalizedEventValue = null;
        if (eventType === 'rating') {
          const n = Number(eventValue);
          if (!Number.isFinite(n) || n < 1 || n > 5) {
            res.status(400).json({ error: 'rating event requires eventValue between 1 and 5' });
            return;
          }
          normalizedEventValue = Math.round(n * 10) / 10;
        }

        const user = userId
          ? await findUserByIdOrExternalId(pool, userId)
          : await findUserByIdOrExternalId(pool, userExternalId);

        if (!user) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        const movie = movieId
          ? await findMovieByIdOrExternalId(pool, movieId)
          : await findMovieByIdOrExternalId(pool, movieExternalId);

        if (!movie) {
          res.status(404).json({ error: 'Movie not found' });
          return;
        }

        const eventWeight = eventType === 'watch_complete'
          ? 1.2
          : eventType === 'watch_start'
            ? 0.4
            : eventType === 'like'
              ? 2.2
              : eventType === 'rating'
                ? normalizedEventValue
                : -0.2;

        const insertResult = await pool.query(
          `
            INSERT INTO interaction_events (
              user_id,
              movie_id,
              event_type,
              event_value,
              event_weight,
              source,
              occurred_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()))
            RETURNING id, user_id, movie_id, event_type, event_value, event_weight, source, occurred_at
          `,
          [user.id, movie.id, eventType, normalizedEventValue, eventWeight, source, occurredAt]
        );

        res.status(201).json({
          message: 'Interaction created',
          user: { id: user.id, external_id: user.external_id, full_name: user.full_name },
          movie: { id: movie.id, external_id: movie.external_id, title: movie.title },
          interaction: insertResult.rows[0]
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to create interaction', details: error.message });
      }
    });

    return router;
  }
}
