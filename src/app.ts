import express from 'express';
import cors from 'cors';
import routes from './routes';

const app = express();

// Global Middlewares
app.use(cors()); // Mengizinkan request dari domain lain (penting jika frontend di-host terpisah)
app.use(express.json()); // Parsing body request berformat JSON

// Mount Routing modular ke path '/api'
app.use('/api', routes);

// Penanganan Route 404 (Not Found) jika client mengakses endpoint yang tidak terdaftar
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Rute tidak ditemukan: ${req.method} ${req.originalUrl}`,
  });
});

export default app;
