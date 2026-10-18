import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the browser talks only to Vite; /api calls are forwarded to the backend.
// Same origin = the login cookie works without any CORS setup.
const proxy = { '/api': 'http://localhost:4000' };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy }
});
