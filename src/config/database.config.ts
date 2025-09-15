import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USER || 'olaclick_user',
  password: process.env.DB_PASSWORD || 'olaclick_pass',
  name: process.env.DB_NAME || 'olaclick_db',
}));