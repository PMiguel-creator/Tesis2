import express from 'express';
import 'dotenv/config';
import alertsRouter from './routes/alerts.js';

const app = express();
app.use(express.json());
app.use('/api', alertsRouter);

const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor API corriendo en http://localhost:${PORT}`);
});
