import { Router } from 'express';
import { parseLimit, parsePage, toOffset } from '../services/httpUtils.js';

export class MoviesController {
  static router({ pool }) {
    const router = Router();

    router.get('/api/movies', async (req, res) => {
      try {
        const page = parsePage(req.query.page);
        const limit = parseLimit(req.query.limit, { defaultValue: 20, max: 100 });
        const offset = toOffset(page, limit);

        const totalResult = await pool.query('SELECT COUNT(*)::int AS total FROM movies');
        const total = totalResult.rows[0]?.total || 0;

        const moviesResult = await pool.query(
          `
            SELECT
              m.id,
              m.external_id,
              m.title,
              m.release_date,
              m.runtime_min,
              m.popularity_score,
              COALESCE(STRING_AGG(g.name, ', ' ORDER BY g.name), '') AS genres
            FROM movies m
            LEFT JOIN movie_genres mg ON mg.movie_id = m.id
            LEFT JOIN genres g ON g.id = mg.genre_id
            GROUP BY m.id
            ORDER BY m.title
            LIMIT $1 OFFSET $2
          `,
          [limit, offset]
        );

        res.json({
          data: moviesResult.rows,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch movies', details: error.message });
      }
    });

    router.get('/api/movies/:id', async (req, res) => {
      try {
        const movieResult = await pool.query(
          `
            SELECT
              m.id,
              m.external_id,
              m.title,
              m.original_title,
              m.synopsis,
              m.release_date,
              m.runtime_min,
              m.popularity_score,
              COALESCE(STRING_AGG(g.name, ', ' ORDER BY g.name), '') AS genres
            FROM movies m
            LEFT JOIN movie_genres mg ON mg.movie_id = m.id
            LEFT JOIN genres g ON g.id = mg.genre_id
            WHERE m.id::text = $1 OR m.external_id = $1
            GROUP BY m.id
            LIMIT 1
          `,
          [req.params.id]
        );

        if (!movieResult.rowCount) {
          res.status(404).json({ error: 'Movie not found' });
          return;
        }

        res.json(movieResult.rows[0]);
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch movie', details: error.message });
      }
    });

    return router;
  }
}
