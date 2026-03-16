import { Router } from 'express';
import { parseLimit, parsePage, toOffset } from '../services/httpUtils.js';
import { findMovieByIdOrExternalId, findUserByIdOrExternalId } from '../services/identityService.js';

const toSlug = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);

export class UsersController {
  static router({ pool }) {
    const router = Router();

    router.get('/api/users', async (req, res) => {
      try {
        const page = parsePage(req.query.page);
        const limit = parseLimit(req.query.limit, { defaultValue: 20, max: 100 });
        const offset = toOffset(page, limit);

        const totalResult = await pool.query('SELECT COUNT(*)::int AS total FROM users');
        const total = totalResult.rows[0]?.total || 0;

        const usersResult = await pool.query(
          `
            SELECT id, external_id, full_name, email, birth_date, created_at
            FROM users
            ORDER BY full_name
            LIMIT $1 OFFSET $2
          `,
          [limit, offset]
        );

        res.json({
          data: usersResult.rows,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
      } catch (error) {
        const details = error instanceof Error
          ? error.message
          : JSON.stringify(error);
        res.status(500).json({ error: 'Failed to fetch users', details: details || 'Unknown database error' });
      }
    });

    router.get('/api/users/:id', async (req, res) => {
      try {
        const user = await findUserByIdOrExternalId(pool, req.params.id);
        if (!user) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        res.json(user);
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user', details: error.message });
      }
    });

    router.get('/api/users/:id/interactions', async (req, res) => {
      try {
        const page = parsePage(req.query.page);
        const limit = parseLimit(req.query.limit, { defaultValue: 20, max: 100 });
        const offset = toOffset(page, limit);

        const user = await findUserByIdOrExternalId(pool, req.params.id);
        if (!user) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        const totalResult = await pool.query(
          'SELECT COUNT(*)::int AS total FROM interaction_events WHERE user_id = $1',
          [user.id]
        );
        const total = totalResult.rows[0]?.total || 0;

        const interactionsResult = await pool.query(
          `
            SELECT
              ie.id,
              ie.event_type,
              ie.event_value,
              ie.event_weight,
              ie.source,
              ie.occurred_at,
              m.id AS movie_id,
              m.external_id AS movie_external_id,
              m.title AS movie_title,
              m.release_date
            FROM interaction_events ie
            JOIN movies m ON m.id = ie.movie_id
            WHERE ie.user_id = $1
            ORDER BY ie.occurred_at DESC
            LIMIT $2 OFFSET $3
          `,
          [user.id, limit, offset]
        );

        res.json({
          user,
          data: interactionsResult.rows,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user interactions', details: error.message });
      }
    });

    router.post('/api/users/:id/movies', async (req, res) => {
      const client = await pool.connect();
      try {
        const {
          movieId,
          eventType = 'watch_complete',
          watchedAt = null,
          source = 'api'
        } = req.body || {};

        const allowedEvents = new Set(['watch_start', 'watch_complete']);
        if (!allowedEvents.has(eventType)) {
          res.status(400).json({ error: 'Invalid eventType', allowed: Array.from(allowedEvents) });
          return;
        }

        if (!movieId) {
          res.status(400).json({ error: 'movieId is required' });
          return;
        }

        const user = await findUserByIdOrExternalId(client, req.params.id);
        if (!user) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        const movie = await findMovieByIdOrExternalId(client, movieId);
        if (!movie) {
          res.status(404).json({ error: 'Movie not found' });
          return;
        }

        const existing = await client.query(
          `SELECT id FROM interaction_events WHERE user_id = $1 AND movie_id = $2 LIMIT 1`,
          [user.id, movie.id]
        );
        if (existing.rowCount > 0) {
          res.status(409).json({ error: 'User already has an interaction with this movie' });
          return;
        }

        const eventWeight = eventType === 'watch_complete' ? 1.2 : 0.4;

        const result = await client.query(
          `INSERT INTO interaction_events (user_id, movie_id, event_type, event_weight, source, occurred_at, metadata)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7::jsonb)
           RETURNING id, event_type, event_weight, source, occurred_at`,
          [user.id, movie.id, eventType, eventWeight, source, watchedAt, JSON.stringify({ entrypoint: 'user-movies' })]
        );

        res.status(201).json({ message: 'Movie added to user', user, movie, interaction: result.rows[0] });
      } catch (error) {
        res.status(500).json({ error: 'Failed to add movie to user', details: error.message });
      } finally {
        client.release();
      }
    });

    router.delete('/api/users/:id/movies/:movieId', async (req, res) => {
      const client = await pool.connect();
      try {
        const user = await findUserByIdOrExternalId(client, req.params.id);
        if (!user) {
          res.status(404).json({ error: 'User not found' });
          return;
        }

        const movie = await findMovieByIdOrExternalId(client, req.params.movieId);
        if (!movie) {
          res.status(404).json({ error: 'Movie not found' });
          return;
        }

        const deleted = await client.query(
          `DELETE FROM interaction_events WHERE user_id = $1 AND movie_id = $2 RETURNING id`,
          [user.id, movie.id]
        );

        res.json({ message: 'Movie removed from user interactions', deletedCount: deleted.rowCount });
      } catch (error) {
        res.status(500).json({ error: 'Failed to remove movie from user', details: error.message });
      } finally {
        client.release();
      }
    });

    router.post('/api/users/:id/profile-watch', async (req, res) => {
      const client = await pool.connect();
      try {
        const {
          user = {},
          movie = {},
          watchedAt = null,
          source = 'api',
          eventType = 'watch_complete'
        } = req.body || {};

        const allowedEvents = new Set(['watch_start', 'watch_complete']);
        if (!allowedEvents.has(eventType)) {
          res.status(400).json({ error: 'Invalid eventType', allowed: Array.from(allowedEvents) });
          return;
        }

        await client.query('BEGIN');

        const routeUserParam = req.params.id;
        const lookupUserParam = routeUserParam === 'new' ? (user.externalId || user.id || null) : routeUserParam;

        let targetUser = lookupUserParam
          ? await findUserByIdOrExternalId(client, lookupUserParam)
          : null;

        const birthDate = user.birthDate || user.birth_date || null;
        const fullName = user.fullName || user.full_name || null;
        const email = user.email || null;
        const externalId = user.externalId || user.external_id || (routeUserParam !== 'new' ? routeUserParam : null);

        if (!targetUser) {
          if (!fullName) {
            res.status(400).json({ error: 'fullName is required when creating a new user' });
            return;
          }

          const insertUserResult = await client.query(
            `
              INSERT INTO users (external_id, full_name, email, birth_date)
              VALUES ($1, $2, $3, $4)
              RETURNING id, external_id, full_name, email, birth_date, created_at
            `,
            [externalId, fullName, email, birthDate]
          );
          targetUser = insertUserResult.rows[0];
        } else {
          const updateUserResult = await client.query(
            `
              UPDATE users
              SET
                full_name = COALESCE($2, full_name),
                email = COALESCE($3, email),
                birth_date = COALESCE($4::date, birth_date),
                updated_at = NOW()
              WHERE id = $1
              RETURNING id, external_id, full_name, email, birth_date, created_at
            `,
            [targetUser.id, fullName, email, birthDate]
          );
          targetUser = updateUserResult.rows[0];
        }

        const preferredGenres = Array.isArray(user.preferredGenres)
          ? user.preferredGenres
          : Array.isArray(user.preferred_genres)
            ? user.preferred_genres
            : [];

        if (preferredGenres.length) {
          await client.query('DELETE FROM user_preferred_genres WHERE user_id = $1', [targetUser.id]);

          for (const genreValue of preferredGenres) {
            const genreName = String(genreValue || '').trim();
            if (!genreName) continue;
            const genreSlug = toSlug(genreName) || 'genre';

            const genreResult = await client.query(
              `
                INSERT INTO genres (slug, name)
                VALUES ($1, $2)
                ON CONFLICT (slug)
                DO UPDATE SET name = EXCLUDED.name
                RETURNING id
              `,
              [genreSlug, genreName]
            );

            await client.query(
              `
                INSERT INTO user_preferred_genres (user_id, genre_id, affinity_score)
                VALUES ($1, $2, 1.0000)
                ON CONFLICT (user_id, genre_id)
                DO UPDATE SET affinity_score = EXCLUDED.affinity_score
              `,
              [targetUser.id, genreResult.rows[0].id]
            );
          }
        }

        const movieParam = movie.id || movie.externalId || movie.external_id || null;
        if (!movieParam) {
          res.status(400).json({ error: 'movie.id or movie.externalId is required' });
          return;
        }

        const targetMovie = await findMovieByIdOrExternalId(client, movieParam);
        if (!targetMovie) {
          res.status(404).json({ error: 'Movie not found' });
          return;
        }

        const eventWeight = eventType === 'watch_complete' ? 1.2 : 0.4;

        const interactionResult = await client.query(
          `
            INSERT INTO interaction_events (
              user_id,
              movie_id,
              event_type,
              event_weight,
              source,
              occurred_at,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7::jsonb)
            RETURNING id, event_type, event_weight, source, occurred_at
          `,
          [
            targetUser.id,
            targetMovie.id,
            eventType,
            eventWeight,
            source,
            watchedAt,
            JSON.stringify({ entrypoint: 'profile-watch', preferredGenresCount: preferredGenres.length })
          ]
        );

        await client.query('COMMIT');

        res.status(201).json({
          message: 'User profile and watched movie saved',
          user: targetUser,
          movie: targetMovie,
          interaction: interactionResult.rows[0],
          preferredGenresApplied: preferredGenres
        });
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {
          // Ignore rollback errors.
        }
        res.status(500).json({ error: 'Failed to save profile and watched movie', details: error.message });
      } finally {
        client.release();
      }
    });

    return router;
  }
}
