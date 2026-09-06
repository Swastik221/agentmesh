import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
};
