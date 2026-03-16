import { Router } from 'express';

export class HealthController {
  static router({ pool }) {
    const router = Router();

    router.get('/health', async (_req, res) => {
      try {
        await pool.query('SELECT 1');
        res.json({ ok: true });
      } catch (error) {
        const details = error instanceof Error
          ? error.message
          : JSON.stringify(error);
        res.status(500).json({ ok: false, error: details || 'Unknown database error' });
      }
    });

    return router;
  }
}
