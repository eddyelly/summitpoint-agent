import { Router } from 'express';
import path from 'path';

export function adminRoutes(): Router {
  const router = Router();

  router.get('/admin', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'admin', 'index.html'));
  });

  return router;
}
