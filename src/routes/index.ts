import { Router } from 'express';
import { receiveWhatsappChat } from '../controllers/webhook.controller';

const router = Router();

/**
 * Health check endpoint - Penting untuk memantau status server secara otomatis (misalnya oleh load balancer atau health monitoring tool).
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is healthy and running!',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Endpoint Webhook WhatsApp - Menerima payload chat dan memprosesnya
 */
router.post('/webhook', receiveWhatsappChat);

export default router;
